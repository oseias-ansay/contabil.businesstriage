/** GET /api/companies/:id/entries/:entryId — lançamento com partidas, autor e vínculo de estorno. */
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/db";
import { accounts, costCenters, journalEntries, journalLines, users } from "@/db/schema";
import { notFound, route } from "@/lib/api";
import { requireCompany } from "@/lib/company-ctx";

export const GET = route<{ id: string; entryId: string }>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const co = await requireCompany(tx, params.id);
    const reversal = alias(journalEntries, "reversal");
    const original = alias(journalEntries, "original");
    const [e] = await tx
      .select({
        entry: journalEntries,
        author: users.name,
        reversedBy: { id: reversal.id, number: reversal.number },
        reverses: { id: original.id, number: original.number },
      })
      .from(journalEntries)
      .leftJoin(users, eq(users.id, journalEntries.createdById))
      .leftJoin(reversal, eq(reversal.reversesEntryId, journalEntries.id))
      .leftJoin(original, eq(original.id, journalEntries.reversesEntryId))
      .where(and(eq(journalEntries.id, params.entryId), eq(journalEntries.companyId, co.id)));
    if (!e) notFound("Lançamento");
    const lines = await tx
      .select({ lineNo: journalLines.lineNo, accountId: accounts.id, code: accounts.code, name: accounts.name, costCenter: costCenters.name, debit: journalLines.debit, credit: journalLines.credit, memo: journalLines.memo })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .leftJoin(costCenters, eq(costCenters.id, journalLines.costCenterId))
      .where(eq(journalLines.entryId, e.entry.id))
      .orderBy(journalLines.lineNo);
    return { ...e.entry, author: e.author, reversedBy: e.reversedBy?.id ? e.reversedBy : null, reverses: e.reverses?.id ? e.reverses : null, lines };
  }),
);
