/** POST /api/companies/:id/bank/lines/classify { lineIds, accountId|null, costCenterId? } — define a contrapartida. */
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { requireCompany } from "@/lib/company-ctx";
import { classifyLines, classifySchema, requireBankModule } from "@/lib/bank/service";

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, classifySchema);
    return withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      return { updated: await classifyLines(tx, co.id, body) };
    });
  },
  { minRole: "OPERATOR" },
);
