/** PATCH/DELETE /api/companies/:id/bank/rules/:ruleId — edita ou exclui a regra. */
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";
import { deleteRule, requireBankModule, ruleInputSchema, saveRule } from "@/lib/bank/service";

export const PATCH = route<{ id: string; ruleId: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, ruleInputSchema);
    return withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      return saveRule(tx, ledgerCtx(auth), co.id, body, params.ruleId);
    });
  },
  { minRole: "OPERATOR" },
);

export const DELETE = route<{ id: string; ruleId: string }>(
  async (_req, { auth, params }) =>
    withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      await deleteRule(tx, ledgerCtx(auth), co.id, params.ruleId);
      return { ok: true };
    }),
  { minRole: "OPERATOR" },
);
