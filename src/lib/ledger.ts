/**
 * Serviço do livro-razão. Toda escrita contábil passa por aqui, sempre
 * dentro de uma transação aberta com withTenant() (RLS ativo).
 *
 * As regras críticas (partidas dobradas, período fechado, imutabilidade,
 * conta analítica) também são impostas pelo banco (drizzle/rules.sql).
 * As validações daqui existem para devolver mensagens claras antes de
 * chegar ao banco, não para substituí-lo.
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
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
