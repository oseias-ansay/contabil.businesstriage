/**
 * GET  /api/companies/:id/periods                — meses da empresa com status e nº de lançamentos
 * GET  /api/companies/:id/periods?checklist=AAAA-MM — conferências antes de fechar o mês
 * POST /api/companies/:id/periods { competence, status } — fecha ou reabre (gestor+)
 */
import { z } from "zod";
import { withTenant } from "@/db";
import { ApiError, parseBody, route } from "@/lib/api";
import { closingChecklist, listPeriods, setPeriodStatus } from "@/lib/ledger";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";

export const GET = route<{ id: string }>(async (req, { auth, params }) => {
  const check = new URL(req.url).searchParams.get("checklist");
  return withTenant(auth.tenantId, async (tx) => {
    const co = await requireCompany(tx, params.id);
    if (check) {
      if (!/^\d{4}-\d{2}$/.test(check)) throw new ApiError(422, "Mês inválido");
      return closingChecklist(tx, co.id, `${check}-01`);
    }
    return listPeriods(tx, co.id);
  });
});

const schema = z.object({
  competence: z.string().regex(/^\d{4}-\d{2}$/, "Mês no formato AAAA-MM"),
  status: z.enum(["OPEN", "CLOSED"]),
  acceptWarnings: z.boolean().default(false),
});

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, schema);
    return withTenant(auth.tenantId, async (tx) => {
      const co = await requireCompany(tx, params.id);
      if (body.status === "CLOSED") {
        const items = await closingChecklist(tx, co.id, `${body.competence}-01`);
        const blocking = items.filter((i) => i.blocking && !i.ok);
        if (blocking.length) throw new ApiError(422, blocking.map((i) => i.detail ?? i.label).join("; "), items);
        const warnings = items.filter((i) => !i.blocking && !i.ok);
        if (warnings.length && !body.acceptWarnings) throw new ApiError(409, "Há avisos a confirmar antes de fechar", items);
      }
      return setPeriodStatus(tx, ledgerCtx(auth), { companyId: co.id, competence: `${body.competence}-01`, status: body.status });
    });
  },
  { minRole: "MANAGER" },
);
