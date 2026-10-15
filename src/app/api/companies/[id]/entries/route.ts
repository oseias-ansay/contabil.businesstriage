/**
 * GET  /api/companies/:id/entries?from&to&q&accountId&page — lançamentos do período (mais recentes primeiro)
 * POST /api/companies/:id/entries — novo lançamento em partidas dobradas (operador+)
 */
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { entryInputSchema, postEntry, type EntryInput } from "@/lib/ledger";
import { ledgerCtx, rangeFrom, requireCompany } from "@/lib/company-ctx";

const PAGE = 50;

export const GET = route<{ id: string }>(async (req, { auth, params }) => {
  const url = new URL(req.url);
  const range = rangeFrom(url);
  const q = url.searchParams.get("q")?.trim();
  const accountId = url.searchParams.get("accountId");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  return withTenant(auth.tenantId, async (tx) => {
    const co = await requireCompany(tx, params.id);
    const where = and(
      eq(journalEntries.companyId, co.id),
      gte(journalEntries.entryDate, range.from),
      lte(journalEntries.entryDate, range.to),
      q ? or(ilike(journalEntries.memo, `%${q}%`), sql`${journalEntries.number}::text = ${q}`) : undefined,
      accountId ? sql`exists (select 1 from journal_lines l where l.entry_id = journal_entries.id and l.account_id = ${accountId})` : undefined,
    );
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(journalEntries).where(where);
    const entries = await tx
      .select({
        id: journalEntries.id,
        number: journalEntries.number,
        entryDate: journalEntries.entryDate,
        memo: journalEntries.memo,
        source: journalEntries.source,
        reversesEntryId: journalEntries.reversesEntryId,
        createdAt: journalEntries.createdAt,
        amount: sql<string>`(select sum(debit) from journal_lines l where l.entry_id = journal_entries.id)`,
        reversedBy: sql<number | null>`(select r.number from journal_entries r where r.reverses_entry_id = journal_entries.id)`,
      })
      .from(journalEntries)
      .where(where)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.number))
      .limit(PAGE)
      .offset((page - 1) * PAGE);

    const ids = entries.map((e) => e.id);
    const lines = ids.length
      ? await tx
          .select({
            entryId: journalLines.entryId,
            lineNo: journalLines.lineNo,
            code: accounts.code,
            name: accounts.name,
            debit: journalLines.debit,
            credit: journalLines.credit,
            memo: journalLines.memo,
          })
          .from(journalLines)
          .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
          .where(inArray(journalLines.entryId, ids))
          .orderBy(journalLines.lineNo)
      : [];
    return {
      total,
      page,
      pageSize: PAGE,
      entries: entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entryId === e.id) })),
    };
  });
});

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    // Valida aqui (mensagens de erro), mas repassa o corpo ORIGINAL ao serviço:
    // os valores viram centavos uma única vez, dentro de postEntry().
    const raw = (await req.json().catch(() => {
      throw new ApiError(400, "JSON inválido");
    })) as EntryInput;
    const body = entryInputSchema.omit({ companyId: true }).parse(raw);
    return withTenant(auth.tenantId, async (tx) => {
      const co = await requireCompany(tx, params.id);
      if (!co.isActive) throw new ApiError(422, "Empresa inativa: não aceita novos lançamentos");
      if (body.entryDate < co.startDate) throw new ApiError(422, `Data anterior ao início da escrituração (${co.startDate.split("-").reverse().join("/")})`);
      const r = await postEntry(tx, ledgerCtx(auth), { ...raw, companyId: co.id });
      return Response.json(r.entry, { status: r.duplicate ? 200 : 201 });
    });
  },
  { minRole: "OPERATOR" },
);
