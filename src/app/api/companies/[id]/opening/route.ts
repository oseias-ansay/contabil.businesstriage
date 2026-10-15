/**
 * GET  /api/companies/:id/opening — lançamentos de abertura já feitos
 * POST /api/companies/:id/opening { entryDate, balances: [{ accountId, amount }] } — gera o lançamento (gestor+)
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { journalEntries } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { openingSchema, postOpeningBalances } from "@/lib/ledger";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";

export const GET = route<{ id: string }>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const co = await requireCompany(tx, params.id);
    return tx
      .select({ id: journalEntries.id, number: journalEntries.number, entryDate: journalEntries.entryDate, memo: journalEntries.memo })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, co.id), eq(journalEntries.source, "OPENING")));
  }),
);

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    // corpo original: os valores viram centavos uma única vez, dentro do serviço
    const raw = await req.json().catch(() => {
      throw new ApiError(400, "JSON inválido");
    });
    openingSchema.parse(raw);
    return withTenant(auth.tenantId, async (tx) => {
      const co = await requireCompany(tx, params.id);
      const r = await postOpeningBalances(tx, ledgerCtx(auth), co.id, raw);
      return Response.json(r.entry, { status: 201 });
    });
  },
  { minRole: "MANAGER" },
);
