/** POST /api/companies/:id/bank/lines/ignore { lineIds, ignored } — ignora (ex.: transferência já lançada) ou reativa. */
import { z } from "zod";
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { requireCompany } from "@/lib/company-ctx";
import { requireBankModule, setIgnored } from "@/lib/bank/service";

const schema = z.object({ lineIds: z.array(z.string().uuid()).min(1).max(500), ignored: z.boolean() });

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, schema);
    return withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      return { updated: await setIgnored(tx, co.id, body.lineIds, body.ignored) };
    });
  },
  { minRole: "OPERATOR" },
);
