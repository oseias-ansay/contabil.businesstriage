/** POST /api/companies/:id/entries/:entryId/reverse { entryDate, memo? } — estorna o lançamento (operador+). */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { journalEntries } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { reverseEntry } from "@/lib/ledger";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";

const schema = z.object({ entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), memo: z.string().trim().max(500).optional() });

export const POST = route<{ id: string; entryId: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, schema);
    return withTenant(auth.tenantId, async (tx) => {
      const co = await requireCompany(tx, params.id);
      const [e] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.id, params.entryId), eq(journalEntries.companyId, co.id)));
      if (!e) notFound("Lançamento");
      const rev = await reverseEntry(tx, ledgerCtx(auth), { entryId: e.id, entryDate: body.entryDate, memo: body.memo });
      return Response.json(rev, { status: 201 });
    });
  },
  { minRole: "OPERATOR" },
);
