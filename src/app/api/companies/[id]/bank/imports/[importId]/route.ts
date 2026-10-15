/** DELETE /api/companies/:id/bank/imports/:importId — exclui a importação (se nada dela foi lançado). Gestor+. */
import { withTenant } from "@/db";
import { route } from "@/lib/api";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";
import { deleteImport, requireBankModule } from "@/lib/bank/service";

export const DELETE = route<{ id: string; importId: string }>(
  async (_req, { auth, params }) =>
    withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      await deleteImport(tx, ledgerCtx(auth), co.id, params.importId);
      return { ok: true };
    }),
  { minRole: "MANAGER" },
);
