/**
 * Extratos bancários: importar, sugerir conta (regras e histórico), classificar,
 * lançar e desfazer. Sempre dentro de withTenant() (RLS ativo).
 *
 * Cada movimento lançado vira UM lançamento em partidas dobradas:
 *   entrada (+) → D conta bancária / C contrapartida
 *   saída  (−) → D contrapartida   / C conta bancária
 * com origem BANK_IMPORT e externalId = "<id da linha>#<revisão>", o que impede
 * lançar o mesmo movimento duas vezes (o banco recusa o externalId repetido).
 */
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { accounts, bankImports, bankLines, classificationRules, costCenters, journalEntries, tenants } from "@/db/schema";
import { audit, LedgerError, postEntry, reverseEntry, type LedgerCtx } from "../ledger";
import { fromCents, toCents } from "../money";
import type { ParseResult } from "./parse";
import { normalizeText, signature } from "./text";

export { patternFromDescription, signature } from "./text";

// ─────────────────────────── Módulo do plano ───────────────────────────

export async function requireBankModule(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ modules: tenants.enabledModules }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t?.modules.includes("bank")) throw new LedgerError("Seu plano não inclui a importação de extratos");
}

// ─────────────────────────── Contas bancárias ───────────────────────────

/** Contas que podem receber extrato: analíticas ativas de disponibilidades (1.1.1) e cartões/limites (2.1.4). */
export async function bankAccountsOf(tx: Tx, companyId: string) {
  return tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.isAnalytic, true),
        eq(accounts.isActive, true),
        or(like(accounts.code, "1.1.1.%"), like(accounts.code, "2.1.4.%")),
      ),
    )
    .orderBy(sql`string_to_array(${accounts.code}, '.')::int[]`);
}

async function requireAnalytic(tx: Tx, companyId: string, accountId: string, label = "Conta") {
  const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!a) throw new LedgerError(`${label} não encontrada nesta empresa`);
  if (!a.isAnalytic) throw new LedgerError(`${label} ${a.code} é sintética: escolha uma conta analítica`);
  if (!a.isActive) throw new LedgerError(`${label} ${a.code} está inativa`);
  return a;
}

// ─────────────────────────── Importação ───────────────────────────

/** Grava as linhas novas do extrato (as já importadas antes são ignoradas) e sugere as contas. */
export async function importStatement(
  tx: Tx,
  ctx: LedgerCtx,
  input: { companyId: string; bankAccountId: string; fileName: string; parsed: ParseResult },
) {
  const bank = await requireAnalytic(tx, input.companyId, input.bankAccountId, "Conta bancária");
  const allowed = await bankAccountsOf(tx, input.companyId);
  if (!allowed.some((a) => a.id === bank.id)) throw new LedgerError(`A conta ${bank.code} não é de disponibilidades nem de cartão/limite`);
  const lines = input.parsed.lines;
  if (!lines.length) throw new LedgerError("O arquivo não tem movimentos para importar");
  const dates = lines.map((l) => l.date).sort();

  const [imp] = await tx
    .insert(bankImports)
    .values({
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      bankAccountId: bank.id,
      fileName: input.fileName.slice(0, 200),
      format: input.parsed.format,
      firstDate: dates[0],
      lastDate: dates.at(-1),
      linesTotal: lines.length,
      createdById: ctx.userId ?? null,
    })
    .returning();

  const inserted: { id: string }[] = [];
  // em lotes, para extratos grandes
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    inserted.push(
      ...(await tx
        .insert(bankLines)
        .values(
          chunk.map((l) => ({
            tenantId: ctx.tenantId,
            companyId: input.companyId,
            importId: imp.id,
            bankAccountId: bank.id,
            lineDate: l.date,
            amount: fromCents(l.amount),
            description: l.description,
            normalized: normalizeText(l.description),
            document: l.document,
            dedupeKey: l.dedupeKey,
          })),
        )
        .onConflictDoNothing({ target: [bankLines.bankAccountId, bankLines.dedupeKey] })
        .returning({ id: bankLines.id })),
    );
  }
  await tx.update(bankImports).set({ linesNew: inserted.length }).where(eq(bankImports.id, imp.id));
  const suggested = inserted.length ? await suggestAccounts(tx, input.companyId, inserted.map((r) => r.id)) : 0;
  await audit(tx, ctx, {
    companyId: input.companyId,
    action: "bank.import",
    entity: "bank_import",
    entityId: imp.id,
    after: { file: input.fileName, bank: bank.code, total: lines.length, new: inserted.length, suggested },
  });
  return { import: { ...imp, linesNew: inserted.length }, total: lines.length, new: inserted.length, duplicates: lines.length - inserted.length, suggested };
}

/** Exclui uma importação inteira, se nenhum movimento dela foi lançado. */
export async function deleteImport(tx: Tx, ctx: LedgerCtx, companyId: string, importId: string) {
  const [imp] = await tx.select().from(bankImports).where(and(eq(bankImports.id, importId), eq(bankImports.companyId, companyId)));
  if (!imp) throw new LedgerError("Importação não encontrada");
  const [posted] = await tx.select({ id: bankLines.id }).from(bankLines).where(and(eq(bankLines.importId, imp.id), eq(bankLines.status, "POSTED"))).limit(1);
  if (posted) throw new LedgerError("Há movimentos desta importação já lançados. Desfaça os lançamentos antes de excluir.");
  await tx.delete(bankImports).where(eq(bankImports.id, imp.id));
  await audit(tx, ctx, { companyId, action: "bank.import.delete", entity: "bank_import", entityId: imp.id, before: { file: imp.fileName } });
}

// ─────────────────────────── Sugestão de conta ───────────────────────────

type RuleLike = { id: string; pattern: string; direction: "ANY" | "IN" | "OUT"; bankAccountId: string | null; accountId: string; costCenterId: string | null };

export function ruleMatches(rule: RuleLike, line: { normalized: string; amount: number; bankAccountId: string }) {
  if (rule.bankAccountId && rule.bankAccountId !== line.bankAccountId) return false;
  if (rule.direction === "IN" && line.amount <= 0) return false;
  if (rule.direction === "OUT" && line.amount >= 0) return false;
  // todas as palavras da regra, em qualquer posição ("tarifa servicos" casa com "TARIFA PACOTE DE SERVIÇOS")
  return rule.pattern.split(" ").every((w) => line.normalized.includes(w));
}

/**
 * Sugere a contrapartida dos movimentos pendentes que o usuário ainda não classificou:
 *  1) regras ativas, por prioridade (menor primeiro) e, no empate, padrão mais longo;
 *  2) senão, a conta usada da última vez num movimento lançado com o mesmo histórico (sem números).
 */
export async function suggestAccounts(tx: Tx, companyId: string, lineIds?: string[]) {
  const pending = await tx
    .select()
    .from(bankLines)
    .where(
      and(
        eq(bankLines.companyId, companyId),
        eq(bankLines.status, "PENDING"),
        or(isNull(bankLines.suggestedBy), sql`${bankLines.suggestedBy} <> 'USER'`),
        lineIds ? inArray(bankLines.id, lineIds) : undefined,
      ),
    );
  if (!pending.length) return 0;

  const rules = (
    await tx
      .select()
      .from(classificationRules)
      .where(and(eq(classificationRules.companyId, companyId), eq(classificationRules.isActive, true)))
  ).sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length);

  const history = await tx.execute<{ sig: string; account_id: string; cost_center_id: string | null }>(sql`
    select distinct on (sig) sig, account_id, cost_center_id from (
      select trim(regexp_replace(regexp_replace(normalized, '[^a-z ]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')) as sig,
             account_id, cost_center_id, updated_at
        from bank_lines
       where company_id = ${companyId} and status = 'POSTED' and account_id is not null
    ) h where sig <> '' order by sig, updated_at desc`);
  const bySig = new Map(history.rows.map((r) => [r.sig, r]));

  let n = 0;
  for (const l of pending) {
    const line = { normalized: l.normalized, amount: toCents(l.amount), bankAccountId: l.bankAccountId };
    const rule = rules.find((r) => ruleMatches(r, line));
    let next: { accountId: string | null; costCenterId: string | null; suggestedBy: string | null; ruleId: string | null };
    if (rule) next = { accountId: rule.accountId, costCenterId: rule.costCenterId, suggestedBy: "RULE", ruleId: rule.id };
    else {
      const h = bySig.get(signature(l.normalized));
      next = h ? { accountId: h.account_id, costCenterId: h.cost_center_id, suggestedBy: "HISTORY", ruleId: null } : { accountId: null, costCenterId: null, suggestedBy: null, ruleId: null };
    }
    if (next.accountId !== l.accountId || next.suggestedBy !== l.suggestedBy || next.ruleId !== l.ruleId) {
      await tx.update(bankLines).set(next).where(eq(bankLines.id, l.id));
      if (next.accountId) n++;
    }
  }
  return n;
}

// ─────────────────────────── Classificação manual ───────────────────────────

export const classifySchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  accountId: z.string().uuid().nullable(), // null = limpa a classificação
  costCenterId: z.string().uuid().nullish(),
});

export async function classifyLines(tx: Tx, companyId: string, input: z.infer<typeof classifySchema>) {
  if (input.accountId) await requireAnalytic(tx, companyId, input.accountId);
  if (input.costCenterId) {
    const [cc] = await tx.select().from(costCenters).where(and(eq(costCenters.id, input.costCenterId), eq(costCenters.companyId, companyId)));
    if (!cc) throw new LedgerError("Centro de custo não encontrado");
  }
  const rows = await tx
    .update(bankLines)
    .set({
      accountId: input.accountId,
      costCenterId: input.accountId ? (input.costCenterId ?? null) : null,
      suggestedBy: input.accountId ? "USER" : null,
      ruleId: null,
    })
    .where(and(eq(bankLines.companyId, companyId), eq(bankLines.status, "PENDING"), inArray(bankLines.id, input.lineIds)))
    .returning({ id: bankLines.id });
  return rows.length;
}

export async function setIgnored(tx: Tx, companyId: string, lineIds: string[], ignored: boolean) {
  const rows = await tx
    .update(bankLines)
    .set({ status: ignored ? "IGNORED" : "PENDING" })
    .where(and(eq(bankLines.companyId, companyId), inArray(bankLines.id, lineIds), eq(bankLines.status, ignored ? "PENDING" : "IGNORED")))
    .returning({ id: bankLines.id });
  return rows.length;
}

// ─────────────────────────── Lançar e desfazer ───────────────────────────

/** Lança UM movimento. Chame cada um na própria transação, para um erro não derrubar os outros. */
export async function postBankLine(tx: Tx, ctx: LedgerCtx, companyId: string, lineId: string) {
  const [l] = await tx.select().from(bankLines).where(and(eq(bankLines.id, lineId), eq(bankLines.companyId, companyId))).for("update");
  if (!l) throw new LedgerError("Movimento não encontrado");
  if (l.status === "POSTED") throw new LedgerError("Movimento já lançado");
  if (l.status === "IGNORED") throw new LedgerError("Movimento ignorado: reative antes de lançar");
  if (!l.accountId) throw new LedgerError("Escolha a conta de contrapartida");
  if (l.accountId === l.bankAccountId) throw new LedgerError("A contrapartida não pode ser a própria conta bancária");

  const cents = toCents(l.amount);
  const value = fromCents(Math.abs(cents));
  const counterpart = { accountId: l.accountId, costCenterId: l.costCenterId };
  const bankSide = { accountId: l.bankAccountId };
  const lines = cents > 0 ? [{ ...bankSide, debit: value }, { ...counterpart, credit: value }] : [{ ...counterpart, debit: value }, { ...bankSide, credit: value }];

  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.source, "BANK_IMPORT"), like(journalEntries.externalId, `${l.id}#%`)));
  const { entry } = await postEntry(tx, ctx, {
    companyId,
    entryDate: l.lineDate,
    memo: `${l.description.length >= 3 ? l.description : `Extrato: ${l.description}`}${l.document ? ` (doc. ${l.document})` : ""}`.slice(0, 500),
    source: "BANK_IMPORT",
    externalId: `${l.id}#${n + 1}`,
    lines,
  });
  await tx.update(bankLines).set({ status: "POSTED", entryId: entry.id }).where(eq(bankLines.id, l.id));
  if (l.ruleId) await tx.update(classificationRules).set({ hits: sql`${classificationRules.hits} + 1` }).where(eq(classificationRules.id, l.ruleId));
  return entry;
}

/** Desfaz o lançamento de um movimento (estorno na mesma data) e o devolve aos pendentes. */
export async function unpostBankLine(tx: Tx, ctx: LedgerCtx, companyId: string, lineId: string) {
  const [l] = await tx.select().from(bankLines).where(and(eq(bankLines.id, lineId), eq(bankLines.companyId, companyId))).for("update");
  if (!l || l.status !== "POSTED" || !l.entryId) throw new LedgerError("Movimento não está lançado");
  await reverseEntry(tx, ctx, { entryId: l.entryId, entryDate: l.lineDate, memo: `Estorno de movimento do extrato — ${l.description}`.slice(0, 500) });
  await tx.update(bankLines).set({ status: "PENDING", entryId: null, suggestedBy: "USER" }).where(eq(bankLines.id, l.id));
}

// ─────────────────────────── Regras ───────────────────────────

export const ruleInputSchema = z.object({
  pattern: z
    .string()
    .transform((s) => normalizeText(s))
    .refine((s) => s.length >= 3, "O texto da regra precisa ter pelo menos 3 letras"),
  direction: z.enum(["ANY", "IN", "OUT"]).default("ANY"),
  bankAccountId: z.string().uuid().nullish(),
  accountId: z.string().uuid(),
  costCenterId: z.string().uuid().nullish(),
  priority: z.coerce.number().int().min(1).max(999).default(100),
  isActive: z.boolean().default(true),
  applyToPending: z.boolean().default(true),
});

export async function saveRule(tx: Tx, ctx: LedgerCtx, companyId: string, input: z.input<typeof ruleInputSchema>, ruleId?: string) {
  const data = ruleInputSchema.parse(input);
  await requireAnalytic(tx, companyId, data.accountId);
  if (data.bankAccountId) await requireAnalytic(tx, companyId, data.bankAccountId, "Conta bancária");
  const { applyToPending, ...values } = data;
  const row = ruleId
    ? (
        await tx
          .update(classificationRules)
          .set({ ...values, bankAccountId: values.bankAccountId ?? null, costCenterId: values.costCenterId ?? null })
          .where(and(eq(classificationRules.id, ruleId), eq(classificationRules.companyId, companyId)))
          .returning()
      )[0]
    : (
        await tx
          .insert(classificationRules)
          .values({ ...values, bankAccountId: values.bankAccountId ?? null, costCenterId: values.costCenterId ?? null, tenantId: ctx.tenantId, companyId })
          .returning()
      )[0];
  if (!row) throw new LedgerError("Regra não encontrada");
  const applied = applyToPending ? await suggestAccounts(tx, companyId) : 0;
  await audit(tx, ctx, { companyId, action: ruleId ? "rule.update" : "rule.create", entity: "classification_rule", entityId: row.id, after: { pattern: row.pattern, account: row.accountId } });
  return { rule: row, applied };
}

export async function deleteRule(tx: Tx, ctx: LedgerCtx, companyId: string, ruleId: string) {
  const [r] = await tx.delete(classificationRules).where(and(eq(classificationRules.id, ruleId), eq(classificationRules.companyId, companyId))).returning();
  if (!r) throw new LedgerError("Regra não encontrada");
  // sugestões vindas desta regra voltam a ser calculadas
  await tx.update(bankLines).set({ accountId: null, costCenterId: null, suggestedBy: null, ruleId: null }).where(and(eq(bankLines.ruleId, r.id), eq(bankLines.status, "PENDING")));
  await suggestAccounts(tx, companyId);
  await audit(tx, ctx, { companyId, action: "rule.delete", entity: "classification_rule", entityId: r.id, before: { pattern: r.pattern } });
}

// ─────────────────────────── Consultas ───────────────────────────

export async function listImports(tx: Tx, companyId: string) {
  return tx
    .select({
      import: bankImports,
      bankCode: accounts.code,
      bankName: accounts.name,
      pending: sql<number>`(select count(*)::int from bank_lines l where l.import_id = bank_imports.id and l.status = 'PENDING')`,
      posted: sql<number>`(select count(*)::int from bank_lines l where l.import_id = bank_imports.id and l.status = 'POSTED')`,
    })
    .from(bankImports)
    .innerJoin(accounts, eq(accounts.id, bankImports.bankAccountId))
    .where(eq(bankImports.companyId, companyId))
    .orderBy(desc(bankImports.createdAt))
    .limit(50);
}

export async function listRules(tx: Tx, companyId: string) {
  return tx
    .select({ rule: classificationRules, accountCode: accounts.code, accountName: accounts.name })
    .from(classificationRules)
    .innerJoin(accounts, eq(accounts.id, classificationRules.accountId))
    .where(eq(classificationRules.companyId, companyId))
    .orderBy(asc(classificationRules.priority), asc(classificationRules.pattern));
}
