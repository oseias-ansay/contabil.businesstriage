/** POST /api/companies/:id/bank/lines/:lineId/unpost — desfaz o lançamento do movimento (estorno) e o devolve aos pendentes. */
import { withTenant } from "@/db";
import { route } from "@/lib/api";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";
import { requireBankModule, unpostBankLine } from "@/lib/bank/service";

export const POST = route<{ id: string; lineId: string }>(
  async (_req, { auth, params }) =>
    withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      await unpostBankLine(tx, ledgerCtx(auth), co.id, params.lineId);
      return { ok: true };
    }),
  { minRole: "OPERATOR" },
);
