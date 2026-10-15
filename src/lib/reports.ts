/**
 * Relatórios gerenciais: razão, DRE e balanço patrimonial.
 * Tudo em centavos (inteiros). Sempre chamado dentro de withTenant() (RLS ativo).
 *
 * Convenções de sinal:
 *  · Razão: saldo positivo = saldo na natureza da conta.
 *  · DRE: receitas positivas, custos e despesas negativos (assim as linhas somam).
 *  · Balanço: ativo = débitos − créditos; passivo e PL = créditos − débitos
 *    (contas redutoras aparecem naturalmente negativas dentro do grupo).
 */
import { and, asc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, companies, journalEntries, journalLines } from "@/db/schema";
import { LedgerError } from "./ledger";
import { toCents } from "./money";

const byCode = sql`string_to_array(${accounts.code}, '.')::int[]`;

// ─────────────────────────── Datas ───────────────────────────

/** "2026-03-15" → "2026-03-31". */
export function monthEnd(isoDate: string) {
  const [y, m] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${isoDate.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Meses ("2026-01") entre duas datas, inclusive. */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 120) break;
  }
  return out;
}

/** Início do exercício que contém a data, dado o mês inicial do exercício. */
export function fiscalYearStart(isoDate: string, startMonth: number) {
  const [y, m] = isoDate.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

// ─────────────────────────── Razão ───────────────────────────

export type LedgerLine = {
  entryId: string;
  number: number;
  date: string;
  memo: string;
  lineMemo: string | null;
  source: string;
  accountCode: string;
  accountName: string;
  counterparts: string; // códigos das outras contas do lançamento
  debit: number;
  credit: number;
  balance: number; // saldo corrido, na natureza da conta
};

/**
 * Razão de uma conta no intervalo. Para conta sintética, traz o movimento de
 * todas as analíticas abaixo dela.
 */
export async function generalLedger(tx: Tx, companyId: string, accountId: string, from: string, to: string) {
  const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!acc) throw new LedgerError("Conta não encontrada");
  const sign = acc.nature === "DEBIT" ? 1 : -1;
  const inTree = or(eq(accounts.code, acc.code), sql`${accounts.code} like ${acc.code + ".%"}`);

  const [{ before }] = await tx
    .select({ before: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.companyId, companyId), inTree, sql`${journalEntries.entryDate} < ${from}`));

  const rows = await tx
    .select({
      entryId: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.entryDate,
      memo: journalEntries.memo,
      source: journalEntries.source,
      lineMemo: journalLines.memo,
      accountCode: accounts.code,
      accountName: accounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
      lineId: journalLines.id,
      counterparts: sql<string>`(
        select string_agg(distinct a2.code, ', ' order by a2.code)
        from journal_lines l2 join accounts a2 on a2.id = l2.account_id
        where l2.entry_id = journal_entries.id and l2.id <> journal_lines.id
          and not (a2.code = ${acc.code} or a2.code like ${acc.code + ".%"})
      )`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.companyId, companyId), inTree, gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number), asc(journalLines.lineNo));

  const opening = toCents(before) * sign;
  let balance = opening;
  let debits = 0;
  let credits = 0;
  const lines: LedgerLine[] = rows.map((r) => {
    const d = toCents(r.debit);
    const c = toCents(r.credit);
    debits += d;
    credits += c;
    balance += (d - c) * sign;
    return {
      entryId: r.entryId,
      number: r.number,
      date: r.date,
      memo: r.memo,
      lineMemo: r.lineMemo,
      source: r.source,
      accountCode: r.accountCode,
      accountName: r.accountName,
      counterparts: r.counterparts ?? "",
      debit: d,
      credit: c,
      balance,
    };
  });
  return { account: { id: acc.id, code: acc.code, name: acc.name, nature: acc.nature, isAnalytic: acc.isAnalytic }, from, to, opening, debits, credits, closing: balance, lines };
}

// ─────────────────────────── DRE ───────────────────────────

type DreGroupKey =
  | "RECEITA_BRUTA"
  | "DEDUCOES"
  | "CUSTOS"
  | "DESPESAS_VENDAS"
  | "DESPESAS_ADMINISTRATIVAS"
  | "RECEITAS_FINANCEIRAS"
  | "DESPESAS_FINANCEIRAS"
  | "OUTRAS_RECEITAS"
  | "OUTRAS_DESPESAS"
  | "IR_CSLL";

/** Estrutura da DRE gerencial: grupos (com contas) e linhas de resultado. */
const DRE_LAYOUT: ({ kind: "group"; key: DreGroupKey; label: string } | { kind: "total"; key: string; label: string; sum: DreGroupKey[] })[] = [
  { kind: "group", key: "RECEITA_BRUTA", label: "Receita operacional bruta" },
  { kind: "group", key: "DEDUCOES", label: "(−) Deduções da receita" },
  { kind: "total", key: "RECEITA_LIQUIDA", label: "= Receita líquida", sum: ["RECEITA_BRUTA", "DEDUCOES"] },
  { kind: "group", key: "CUSTOS", label: "(−) Custos das vendas e serviços" },
  { kind: "total", key: "LUCRO_BRUTO", label: "= Lucro bruto", sum: ["RECEITA_BRUTA", "DEDUCOES", "CUSTOS"] },
  { kind: "group", key: "DESPESAS_VENDAS", label: "(−) Despesas com vendas" },
  { kind: "group", key: "DESPESAS_ADMINISTRATIVAS", label: "(−) Despesas administrativas" },
  { kind: "total", key: "RESULTADO_OPERACIONAL", label: "= Resultado operacional", sum: ["RECEITA_BRUTA", "DEDUCOES", "CUSTOS", "DESPESAS_VENDAS", "DESPESAS_ADMINISTRATIVAS"] },
  { kind: "group", key: "RECEITAS_FINANCEIRAS", label: "(+) Receitas financeiras" },
  { kind: "group", key: "DESPESAS_FINANCEIRAS", label: "(−) Despesas financeiras" },
  { kind: "group", key: "OUTRAS_RECEITAS", label: "(+) Outras receitas" },
  { kind: "group", key: "OUTRAS_DESPESAS", label: "(−) Outras despesas" },
  {
    kind: "total",
    key: "RESULTADO_ANTES_IR",
    label: "= Resultado antes do IRPJ e CSLL",
    sum: ["RECEITA_BRUTA", "DEDUCOES", "CUSTOS", "DESPESAS_VENDAS", "DESPESAS_ADMINISTRATIVAS", "RECEITAS_FINANCEIRAS", "DESPESAS_FINANCEIRAS", "OUTRAS_RECEITAS", "OUTRAS_DESPESAS"],
  },
  { kind: "group", key: "IR_CSLL", label: "(−) IRPJ e CSLL" },
  {
    kind: "total",
    key: "RESULTADO_LIQUIDO",
    label: "= Resultado líquido do período",
    sum: ["RECEITA_BRUTA", "DEDUCOES", "CUSTOS", "DESPESAS_VENDAS", "DESPESAS_ADMINISTRATIVAS", "RECEITAS_FINANCEIRAS", "DESPESAS_FINANCEIRAS", "OUTRAS_RECEITAS", "OUTRAS_DESPESAS", "IR_CSLL"],
  },
];

export type DreRow = {
  kind: "group" | "account" | "total";
  key: string;
  label: string;
  code?: string;
  values: number[]; // um por coluna (meses) + total na última posição
  share: number | null; // análise vertical do total sobre a receita líquida (0–1)
};

/**
 * DRE gerencial por competência, com uma coluna por mês e a coluna Total.
 * Lançamentos de encerramento (CLOSING) não entram.
 */
export async function incomeStatement(tx: Tx, companyId: string, from: string, to: string, opts: { monthly?: boolean } = {}) {
  const months = opts.monthly ? monthsBetween(from, to) : [];
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      group: accounts.dreGroup,
      month: sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
      amount: sql<string>`sum(${journalLines.credit} - ${journalLines.debit})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
        ne(journalEntries.source, "CLOSING"),
        inArray(accounts.type, ["REVENUE", "EXPENSE"]),
      ),
    )
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.dreGroup, sql`to_char(${journalEntries.entryDate}, 'YYYY-MM')`);

  const cols = months.length + 1; // meses + total
  const zero = () => new Array<number>(cols).fill(0);
  const groupVals = new Map<string, number[]>();
  const accVals = new Map<string, { code: string; name: string; group: string; values: number[] }>();
  for (const r of rows) {
    const g = r.group ?? "OUTRAS_DESPESAS";
    const v = toCents(r.amount);
    const idx = months.indexOf(r.month);
    const gv = groupVals.get(g) ?? zero();
    const av = accVals.get(r.accountId) ?? { code: r.code, name: r.name, group: g, values: zero() };
    if (idx >= 0) {
      gv[idx] += v;
      av.values[idx] += v;
    }
    gv[cols - 1] += v;
    av.values[cols - 1] += v;
    groupVals.set(g, gv);
    accVals.set(r.accountId, av);
  }

  const sumOf = (keys: DreGroupKey[]) => {
    const out = zero();
    for (const k of keys) groupVals.get(k)?.forEach((v, i) => (out[i] += v));
    return out;
  };
  const netRevenue = sumOf(["RECEITA_BRUTA", "DEDUCOES"])[cols - 1];
  const share = (v: number) => (netRevenue ? v / netRevenue : null);

  const out: DreRow[] = [];
  const totals: Record<string, number> = {};
  for (const item of DRE_LAYOUT) {
    if (item.kind === "group") {
      const values = groupVals.get(item.key) ?? zero();
      out.push({ kind: "group", key: item.key, label: item.label, values, share: share(values[cols - 1]) });
      const accs = [...accVals.values()]
        .filter((a) => a.group === item.key && a.values.some((v) => v !== 0))
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      for (const a of accs) out.push({ kind: "account", key: `${item.key}:${a.code}`, label: a.name, code: a.code, values: a.values, share: share(a.values[cols - 1]) });
    } else {
      const values = sumOf(item.sum);
      totals[item.key] = values[cols - 1];
      out.push({ kind: "total", key: item.key, label: item.label, values, share: share(values[cols - 1]) });
    }
  }
  return { from, to, months, rows: out, netRevenue, netIncome: totals.RESULTADO_LIQUIDO ?? 0, totals };
}

// ─────────────────────────── Balanço patrimonial ───────────────────────────

export type BalanceRow = { code: string; name: string; level: number; isAnalytic: boolean; amount: number; kind?: "result" };

/**
 * Balanço patrimonial gerencial na data. Enquanto não houver lançamentos de
 * encerramento, o resultado aparece no PL em duas linhas calculadas:
 * exercício atual e exercícios anteriores não encerrados.
 */
export async function balanceSheet(tx: Tx, companyId: string, asOf: string) {
  const [co] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!co) throw new LedgerError("Empresa não encontrada");
  const fyStart = fiscalYearStart(asOf, co.fiscalYearStartMonth);

  const accs = await tx.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(byCode);
  const sums = await tx
    .select({
      accountId: journalLines.accountId,
      net: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})`,
      netBeforeFy: sql<string>`coalesce(sum(case when ${journalEntries.entryDate} < ${fyStart} then ${journalLines.debit} - ${journalLines.credit} end), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalEntries.companyId, companyId), lte(journalEntries.entryDate, asOf)))
    .groupBy(journalLines.accountId);
  const net = new Map(sums.map((s) => [s.accountId, { all: toCents(s.net), beforeFy: toCents(s.netBeforeFy) }]));

  // resultado: receitas − despesas = −(débitos − créditos) das contas de resultado
  let resultFy = 0;
  let resultPrior = 0;
  for (const a of accs) {
    if (a.type !== "REVENUE" && a.type !== "EXPENSE") continue;
    const n = net.get(a.id);
    if (!n) continue;
    resultPrior += -n.beforeFy;
    resultFy += -(n.all - n.beforeFy);
  }

  // saldo por conta patrimonial, agregado nas sintéticas pelo prefixo
  const patrimonial = accs.filter((a) => a.type === "ASSET" || a.type === "LIABILITY" || a.type === "EQUITY");
  const amount = new Map<string, number>(patrimonial.map((a) => [a.code, 0]));
  for (const a of patrimonial) {
    const n = net.get(a.id)?.all ?? 0;
    if (!n) continue;
    const v = a.type === "ASSET" ? n : -n;
    const parts = a.code.split(".");
    for (let i = 1; i <= parts.length; i++) {
      const k = parts.slice(0, i).join(".");
      if (amount.has(k)) amount.set(k, amount.get(k)! + v);
    }
  }
  // o resultado não encerrado entra no PL e no total do grupo 2
  const plCode = patrimonial.find((a) => a.type === "EQUITY" && a.level === 2)?.code;
  const unclosed = resultFy + resultPrior;
  for (const k of [plCode, plCode?.split(".")[0]]) if (k && amount.has(k)) amount.set(k, amount.get(k)! + unclosed);

  const rowsFor = (pred: (a: (typeof patrimonial)[number]) => boolean) =>
    patrimonial
      .filter(pred)
      .filter((a) => amount.get(a.code) !== 0 || a.level <= 2)
      .map<BalanceRow>((a) => ({ code: a.code, name: a.name, level: a.level, isAnalytic: a.isAnalytic, amount: amount.get(a.code) ?? 0 }));

  const assets = rowsFor((a) => a.type === "ASSET");
  const liabilities = rowsFor((a) => a.type === "LIABILITY" || a.type === "EQUITY");
  // insere as linhas de resultado logo após a última conta do PL
  const lastPl = liabilities.map((r) => r.code).filter((c) => plCode && (c === plCode || c.startsWith(plCode + "."))).pop();
  const at = lastPl ? liabilities.findIndex((r) => r.code === lastPl) + 1 : liabilities.length;
  const extra: BalanceRow[] = [];
  if (resultPrior) extra.push({ code: "", name: "Resultados de exercícios anteriores não encerrados", level: 3, isAnalytic: true, amount: resultPrior, kind: "result" });
  extra.push({ code: "", name: `Resultado do exercício (desde ${fyStart.split("-").reverse().join("/")})`, level: 3, isAnalytic: true, amount: resultFy, kind: "result" });
  liabilities.splice(at, 0, ...extra);

  const totalAssets = amount.get(assets.find((r) => r.level === 1)?.code ?? "1") ?? 0;
  const totalLiabEq = liabilities.filter((r) => r.level === 1).reduce((s, r) => s + r.amount, 0);
  return { asOf, fiscalYearStart: fyStart, assets, liabilities, totalAssets, totalLiabilitiesEquity: totalLiabEq, difference: totalAssets - totalLiabEq, resultFy, resultPrior };
}
