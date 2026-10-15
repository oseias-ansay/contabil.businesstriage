/**
 * GET  /api/companies/:id/bank/rules — regras de classificação
 * POST /api/companies/:id/bank/rules — nova regra (aplica aos pendentes não classificados à mão)
 */
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";
import { listRules, requireBankModule, ruleInputSchema, saveRule } from "@/lib/bank/service";

export const GET = route<{ id: string }>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    await requireBankModule(tx, auth.tenantId);
    const co = await requireCompany(tx, params.id);
    return listRules(tx, co.id);
  }),
);

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, ruleInputSchema);
    return withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      return Response.json(await saveRule(tx, ledgerCtx(auth), co.id, body), { status: 201 });
    });
  },
  { minRole: "OPERATOR" },
);
