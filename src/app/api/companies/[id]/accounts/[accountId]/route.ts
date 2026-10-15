/** PATCH /api/companies/:id/accounts/:accountId { name?, isActive?, nature? } — edita conta (gestor+). */
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { accountUpdateSchema, updateAccount } from "@/lib/ledger";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";

export const PATCH = route<{ id: string; accountId: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, accountUpdateSchema);
    return withTenant(auth.tenantId, async (tx) => {
      const co = await requireCompany(tx, params.id);
      return updateAccount(tx, ledgerCtx(auth), co.id, params.accountId, body);
    });
  },
  { minRole: "MANAGER" },
);
