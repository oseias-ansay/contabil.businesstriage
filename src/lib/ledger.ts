/**
 * Serviço do livro-razão. Toda escrita contábil passa por aqui, sempre
 * dentro de uma transação aberta com withTenant() (RLS ativo).
 *
 * As regras críticas (partidas dobradas, período fechado, imutabilidade,
 * conta analítica) também são impostas pelo banco (drizzle/rules.sql).
 * As validações daqui existem para devolver mensagens claras antes de
 * chegar ao banco, não para substituí-lo.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { accounts, auditLog, companies, journalEntries, journalLines, periods } from "@/db/schema";
import { fromCents, toCents } from "./money";
import { applyStandardChart } from "./chart-of-accounts";

/** Quem está escrevendo no livro (vai para a trilha de auditoria). */
export type LedgerCtx = { tenantId: string; userId?: string; userName?: string };

export class LedgerError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toCents(v);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
});

// ─────────────────────────── Empresas ───────────────────────────

export const companyInputSchema = z.object({
  legalName: z.string().min(2).max(200),
  tradeName: z.string().max(200).nullish(),
  cnpj: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s.length === 11 || s.length === 14, "CNPJ (14 dígitos) ou CPF (11 dígitos)")
    .nullish()
    .or(z.literal("").transform(() => null)),
  taxRegime: z.enum(["SIMPLES", "PRESUMIDO", "REAL", "MEI", "OUTRO"]).default("SIMPLES"),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  startDate: isoDate,
  externalRefs: z.record(z.string()).optional(),
});
export type CompanyInput = z.input<typeof companyInputSchema>;

/** Cria a empresa já com o plano de contas padrão. */
export async function createCompany(tx: Tx, ctx: LedgerCtx, input: CompanyInput) {
  const data = companyInputSchema.parse(input);
  const [company] = await tx
    .insert(companies)
    .values({ ...data, tenantId: ctx.tenantId, externalRefs: data.externalRefs ?? {} })
    .returning();
  const n = await applyStandardChart(tx, ctx.tenantId, company.id);
  await audit(tx, ctx, { companyId: company.id, action: "company.create", entity: "company", entityId: company.id, after: { ...company, accounts: n } });
  return company;
}

// ─────────────────────────── Lançamentos ───────────────────────────

export const entryInputSchema = z.object({
  companyId: z.string().uuid(),
  entryDate: isoDate,
  memo: z.string().trim().min(3, "Informe o histórico").max(500),
  source: z.enum(["MANUAL", "OPENING", "BANK_IMPORT", "PLATFORM", "CLOSING"]).default("MANUAL"),
  externalId: z.string().max(200).nullish(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        costCenterId: z.string().uuid().nullish(),
        debit: amount.optional(),
        credit: amount.optional(),
        memo: z.string().max(300).nullish(),
      }),
    )
    .min(2, "Um lançamento precisa de pelo menos duas partidas"),
});
export type EntryInput = z.input<typeof entryInputSchema>;

/**
 * Grava um lançamento em partidas dobradas.
 * Idempotente por (empresa, origem, externalId): repetir o mesmo evento
 * devolve o lançamento já existente em vez de duplicar.
 */
export async function postEntry(tx: Tx, ctx: LedgerCtx, input: EntryInput) {
  const data = entryInputSchema.parse(input);

  if (data.externalId) {
    const [existing] = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, data.companyId), eq(journalEntries.source, data.source), eq(journalEntries.externalId, data.externalId)))
      .limit(1);
    if (existing) return { entry: existing, duplicate: true as const };
  }

  let debit = 0;
  let credit = 0;
  data.lines.forEach((l, i) => {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (d < 0 || c < 0) throw new LedgerError(`Partida ${i + 1}: valores não podem ser negativos`);
    if ((d > 0) === (c > 0)) throw new LedgerError(`Partida ${i + 1}: informe débito OU crédito`);
    debit += d;
    credit += c;
  });
  if (debit !== credit) {
    throw new LedgerError(`Lançamento desbalanceado: débitos ${fromCents(debit)} ≠ créditos ${fromCents(credit)}`);
  }

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      tenantId: ctx.tenantId,
      companyId: data.companyId,
      entryDate: data.entryDate,
      memo: data.memo,
      source: data.source,
      externalId: data.externalId ?? null,
      createdById: ctx.userId ?? null,
    })
    .returning();

  await tx.insert(journalLines).values(
    data.lines.map((l, i) => ({
      tenantId: ctx.tenantId,
      entryId: entry.id,
      lineNo: i + 1,
      accountId: l.accountId,
      costCenterId: l.costCenterId ?? null,
      debit: fromCents(l.debit ?? 0),
      credit: fromCents(l.credit ?? 0),
      memo: l.memo ?? null,
    })),
  );

  await audit(tx, ctx, { companyId: data.companyId, action: "entry.post", entity: "journal_entry", entityId: entry.id, after: { number: entry.number, memo: entry.memo, total: fromCents(debit) } });
  return { entry, duplicate: false as const };
}

/** Estorna um lançamento: cria outro com débitos e créditos invertidos. */
export async function reverseEntry(
  tx: Tx,
  ctx: LedgerCtx,
  input: { entryId: string; entryDate: string; memo?: string },
) {
  const [orig] = await tx.select().from(journalEntries).where(eq(journalEntries.id, input.entryId)).limit(1);
  if (!orig) throw new LedgerError("Lançamento não encontrado");
  const [already] = await tx.select({ number: journalEntries.number }).from(journalEntries).where(eq(journalEntries.reversesEntryId, orig.id)).limit(1);
  if (already) throw new LedgerError(`Este lançamento já foi estornado pelo nº ${already.number}`);
  const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, orig.id)).orderBy(asc(journalLines.lineNo));

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      tenantId: ctx.tenantId,
      companyId: orig.companyId,
      entryDate: input.entryDate,
      memo: input.memo?.trim() || `Estorno do lançamento nº ${orig.number} — ${orig.memo}`.slice(0, 500),
      source: "REVERSAL",
      reversesEntryId: orig.id,
      createdById: ctx.userId ?? null,
    })
    .returning();
  await tx.insert(journalLines).values(
    lines.map((l) => ({
      tenantId: ctx.tenantId,
      entryId: entry.id,
      lineNo: l.lineNo,
      accountId: l.accountId,
      costCenterId: l.costCenterId,
      debit: l.credit,
      credit: l.debit,
      memo: l.memo,
    })),
  );
  await audit(tx, ctx, { companyId: orig.companyId, action: "entry.reverse", entity: "journal_entry", entityId: entry.id, before: { number: orig.number }, after: { number: entry.number } });
  return entry;
}

// ─────────────────────────── Períodos ───────────────────────────

const firstDay = (d: string) => `${d.slice(0, 7)}-01`;

/** Fecha ou reabre um mês da empresa (papel mínimo verificado na rota: gestor). */
export async function setPeriodStatus(
  tx: Tx,
  ctx: LedgerCtx,
  input: { companyId: string; competence: string; status: "OPEN" | "CLOSED" },
) {
  const competence = firstDay(input.competence);
  const now = new Date();
  const closing = input.status === "CLOSED";
  const [row] = await tx
    .insert(periods)
    .values({
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      competence,
      status: input.status,
      ...(closing ? { closedById: ctx.userId ?? null, closedAt: now } : { reopenedById: ctx.userId ?? null, reopenedAt: now }),
    })
    .onConflictDoUpdate({
      target: [periods.companyId, periods.competence],
      set: {
        status: input.status,
        ...(closing ? { closedById: ctx.userId ?? null, closedAt: now } : { reopenedById: ctx.userId ?? null, reopenedAt: now }),
      },
    })
    .returning();
  await audit(tx, ctx, { companyId: input.companyId, action: closing ? "period.close" : "period.reopen", entity: "period", entityId: row.id, after: { competence, status: input.status } });
  return row;
}

// ─────────────────────────── Balancete ───────────────────────────

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  level: number;
  isAnalytic: boolean;
  nature: "DEBIT" | "CREDIT";
  opening: number; // centavos, sinal pela natureza da conta (positivo = saldo normal)
  debits: number;
  credits: number;
  closing: number;
};

/**
 * Balancete de verificação do intervalo [from, to] (datas de lançamento).
 * Contas sintéticas somam as analíticas abaixo delas (pelo prefixo do código).
 */
export async function trialBalance(tx: Tx, companyId: string, from: string, to: string): Promise<TrialBalanceRow[]> {
  const accs = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, companyId))
    .orderBy(sql`string_to_array(${accounts.code}, '.')::int[]`);

  const movement = await tx
    .select({
      accountId: journalLines.accountId,
      before: sql<string>`coalesce(sum(case when ${journalEntries.entryDate} < ${from} then ${journalLines.debit} - ${journalLines.credit} end), 0)`,
      debits: sql<string>`coalesce(sum(case when ${journalEntries.entryDate} >= ${from} then ${journalLines.debit} end), 0)`,
      credits: sql<string>`coalesce(sum(case when ${journalEntries.entryDate} >= ${from} then ${journalLines.credit} end), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalEntries.companyId, companyId), lte(journalEntries.entryDate, to)))
    .groupBy(journalLines.accountId);

  const byId = new Map(movement.map((m) => [m.accountId, { net: toCents(m.before), d: toCents(m.debits), c: toCents(m.credits) }]));
  const sign = (nature: string) => (nature === "DEBIT" ? 1 : -1);

  // agrega folhas → todas as contas cujo código é prefixo
  const totals = new Map<string, { net: number; d: number; c: number }>();
  for (const a of accs) totals.set(a.code, { net: 0, d: 0, c: 0 });
  for (const a of accs) {
    const m = byId.get(a.id);
    if (!m) continue;
    const parts = a.code.split(".");
    for (let i = 1; i <= parts.length; i++) {
      const t = totals.get(parts.slice(0, i).join("."));
      if (t) {
        t.net += m.net;
        t.d += m.d;
        t.c += m.c;
      }
    }
  }

  return accs.map((a) => {
    const t = totals.get(a.code)!;
    const s = sign(a.nature);
    const opening = t.net * s;
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      level: a.level,
      isAnalytic: a.isAnalytic,
      nature: a.nature,
      opening,
      debits: t.d,
      credits: t.c,
      closing: opening + (t.d - t.c) * s,
    };
  });
}

// ─────────────────────────── Meses e fechamento ───────────────────────────

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Meses da empresa (do início da escrituração até o mês atual ou o último lançamento). */
export async function listPeriods(tx: Tx, companyId: string) {
  const [co] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!co) throw new LedgerError("Empresa não encontrada");
  const stats = await tx
    .select({
      month: sql<string>`to_char(${journalEntries.competence}, 'YYYY-MM')`,
      entries: sql<number>`count(*)::int`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, companyId))
    .groupBy(journalEntries.competence);
  const status = await tx.select().from(periods).where(eq(periods.companyId, companyId));
  const lastEntry = stats.map((s) => s.month).sort().pop();
  const now = ym(new Date());
  const end = lastEntry && lastEntry > now ? lastEntry : now;

  const out: { month: string; status: "OPEN" | "CLOSED"; entries: number; closedAt: Date | null }[] = [];
  let [y, m] = co.startDate.split("-").map(Number);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    const p = status.find((s) => s.competence.startsWith(key));
    out.push({ month: key, status: p?.status ?? "OPEN", entries: stats.find((s) => s.month === key)?.entries ?? 0, closedAt: p?.closedAt ?? null });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out.reverse(); // mais recente primeiro
}

export type ChecklistItem = { key: string; label: string; ok: boolean; blocking: boolean; detail?: string };

/**
 * Conferências antes de fechar o mês. Itens "blocking" impedem o fechamento;
 * os demais são avisos que o gestor pode aceitar.
 */
export async function closingChecklist(tx: Tx, companyId: string, competence: string): Promise<ChecklistItem[]> {
  const month = competence.slice(0, 7);
  const months = await listPeriods(tx, companyId);
  const current = months.find((p) => p.month === month);
  if (!current) throw new LedgerError("Mês fora do período da empresa");
  const earlierOpen = months.filter((p) => p.month < month && p.status === "OPEN" && p.entries > 0).map((p) => p.month);

  const from = `${month}-01`;
  const [y, mm] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`;
  const tb = await trialBalance(tx, companyId, from, to);
  const top = tb.filter((r) => r.level === 1);
  const d = top.reduce((s, r) => s + r.debits, 0);
  const c = top.reduce((s, r) => s + r.credits, 0);
  const negativeCash = tb.filter((r) => r.isAnalytic && r.code.startsWith("1.1.1.") && r.closing < 0).map((r) => `${r.code} ${r.name}`);
  const pendingBank = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from bank_lines where company_id = ${companyId} and status = 'PENDING' and line_date between ${from} and ${to}`,
  );
  const pendingLines = pendingBank.rows[0]?.n ?? 0;

  return [
    { key: "status", label: "Mês ainda aberto", ok: current.status === "OPEN", blocking: true, detail: current.status === "CLOSED" ? "Este mês já está fechado" : undefined },
    { key: "balanced", label: "Débitos e créditos do mês conferem", ok: d === c, blocking: true, detail: d === c ? undefined : `Débitos ${fromCents(d)} ≠ créditos ${fromCents(c)}` },
    { key: "entries", label: "Há lançamentos no mês", ok: current.entries > 0, blocking: false, detail: current.entries ? `${current.entries} lançamento(s)` : "Nenhum lançamento: confirme se o mês está mesmo sem movimento" },
    { key: "earlier", label: "Meses anteriores fechados", ok: earlierOpen.length === 0, blocking: false, detail: earlierOpen.length ? `Ainda abertos: ${earlierOpen.map((m) => m.split("-").reverse().join("/")).join(", ")}` : undefined },
    { key: "bank", label: "Extratos do mês lançados", ok: pendingLines === 0, blocking: false, detail: pendingLines ? `${pendingLines} movimento(s) de extrato ainda sem lançar` : undefined },
    { key: "cash", label: "Caixa e bancos sem saldo negativo", ok: negativeCash.length === 0, blocking: false, detail: negativeCash.length ? `Saldo negativo em: ${negativeCash.join("; ")}` : undefined },
  ];
}

// ─────────────────────────── Plano de contas ───────────────────────────

export const accountCreateSchema = z.object({
  parentId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  isAnalytic: z.boolean().default(true),
  nature: z.enum(["DEBIT", "CREDIT"]).optional(), // padrão: a da conta-mãe
});

/** Cria subconta com o próximo código livre abaixo da conta-mãe (sintética). */
export async function createAccount(tx: Tx, ctx: LedgerCtx, companyId: string, input: z.input<typeof accountCreateSchema>) {
  const data = accountCreateSchema.parse(input);
  const [parent] = await tx.select().from(accounts).where(and(eq(accounts.id, data.parentId), eq(accounts.companyId, companyId)));
  if (!parent) throw new LedgerError("Conta-mãe não encontrada");
  if (parent.isAnalytic) throw new LedgerError("Contas analíticas não podem ter subcontas. Escolha uma conta sintética.");
  const siblings = await tx.select({ code: accounts.code }).from(accounts).where(eq(accounts.parentId, parent.id));
  const last = siblings.map((s) => Number(s.code.split(".").pop())).reduce((a, b) => Math.max(a, b), 0);
  const width = parent.level >= 3 ? 2 : 1;
  const next = last + 1;
  if (width === 1 && next > 9) throw new LedgerError("Limite de 9 subgrupos atingido neste nível");
  const code = `${parent.code}.${String(next).padStart(width, "0")}`;
  const [row] = await tx
    .insert(accounts)
    .values({
      tenantId: ctx.tenantId,
      companyId,
      parentId: parent.id,
      code,
      name: data.name,
      level: parent.level + 1,
      type: parent.type,
      nature: data.nature ?? parent.nature,
      isAnalytic: data.isAnalytic,
      balanceGroup: parent.balanceGroup,
      dreGroup: parent.dreGroup,
    })
    .returning();
  await audit(tx, ctx, { companyId, action: "account.create", entity: "account", entityId: row.id, after: { code, name: row.name } });
  return row;
}

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
  nature: z.enum(["DEBIT", "CREDIT"]).optional(),
});

/** Renomeia, ativa/inativa ou troca a natureza (o banco recusa natureza de conta movimentada). */
export async function updateAccount(tx: Tx, ctx: LedgerCtx, companyId: string, accountId: string, input: z.input<typeof accountUpdateSchema>) {
  const data = accountUpdateSchema.parse(input);
  const [before] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!before) throw new LedgerError("Conta não encontrada");
  if (data.isActive === false && !before.isAnalytic) {
    // inativar uma sintética inativa as filhas também
    await tx.update(accounts).set({ isActive: false }).where(and(eq(accounts.companyId, companyId), sql`${accounts.code} like ${before.code + ".%"}`));
  }
  const [row] = await tx.update(accounts).set(data).where(eq(accounts.id, accountId)).returning();
  await audit(tx, ctx, { companyId, action: "account.update", entity: "account", entityId: row.id, before: { name: before.name, isActive: before.isActive, nature: before.nature }, after: data });
  return row;
}

// ─────────────────────────── Saldos de abertura ───────────────────────────

export const openingSchema = z.object({
  entryDate: isoDate,
  balances: z
    .array(z.object({ accountId: z.string().uuid(), amount })) // positivo = saldo na natureza da conta
    .min(1, "Informe ao menos um saldo"),
});

/**
 * Gera UM lançamento de abertura (origem OPENING) com os saldos informados.
 * A diferença entre ativo e passivo + PL vai para 2.3.9.01 (contrapartida de
 * saldos de abertura), para o balanço fechar desde o primeiro dia.
 */
export async function postOpeningBalances(tx: Tx, ctx: LedgerCtx, companyId: string, input: z.input<typeof openingSchema>) {
  const data = openingSchema.parse(input);
  const ids = data.balances.map((b) => b.accountId);
  const accs = await tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, ids)));
  const lines: { accountId: string; debit?: number; credit?: number; memo?: string }[] = [];
  for (const b of data.balances) {
    if (!b.amount) continue;
    const a = accs.find((x) => x.id === b.accountId);
    if (!a) throw new LedgerError("Conta de outra empresa no saldo de abertura");
    if (!["ASSET", "LIABILITY", "EQUITY"].includes(a.type)) throw new LedgerError(`${a.code} ${a.name}: saldo de abertura só em contas patrimoniais`);
    const debitSide = (a.nature === "DEBIT") === b.amount > 0;
    const v = Math.abs(b.amount);
    lines.push(debitSide ? { accountId: a.id, debit: v } : { accountId: a.id, credit: v });
  }
  if (!lines.length) throw new LedgerError("Todos os saldos estão zerados");
  const diff = lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
  if (diff !== 0) {
    const [plug] = await tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, "2.3.9.01")));
    if (!plug) throw new LedgerError("Conta 2.3.9.01 (contrapartida de saldos de abertura) não existe no plano de contas");
    lines.push(diff > 0 ? { accountId: plug.id, credit: diff, memo: "Diferença dos saldos de abertura" } : { accountId: plug.id, debit: -diff, memo: "Diferença dos saldos de abertura" });
  }
  return postEntry(tx, ctx, {
    companyId,
    entryDate: data.entryDate,
    memo: "Saldos de abertura",
    source: "OPENING",
    lines: lines.map((l) => ({ ...l, debit: l.debit ? fromCents(l.debit) : undefined, credit: l.credit ? fromCents(l.credit) : undefined })),
  });
}

// ─────────────────────────── Auditoria ───────────────────────────

export async function audit(
  tx: Tx,
  ctx: LedgerCtx,
  e: { companyId?: string; action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
) {
  await tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    companyId: e.companyId ?? null,
    userId: ctx.userId ?? null,
    userName: ctx.userName ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: (e.before ?? null) as object | null,
    after: (e.after ?? null) as object | null,
  });
}
