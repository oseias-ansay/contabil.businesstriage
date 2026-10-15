/**
 * GET  /api/companies — empresas do tenant (com contagem de lançamentos)
 * POST /api/companies — cria empresa já com o plano de contas padrão (gestor+)
 */
import { asc, count, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { companies, tenants } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { companyInputSchema, createCompany } from "@/lib/ledger";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) =>
    tx
      .select({
        company: companies,
        accountsCount: sql<number>`(select count(*)::int from accounts a where a.company_id = companies.id)`,
        entriesCount: sql<number>`(select count(*)::int from journal_entries e where e.company_id = companies.id)`,
      })
      .from(companies)
      .orderBy(asc(companies.legalName)),
  ),
);

export const POST = route(
  async (req, { auth }) => {
    const body = await parseBody(req, companyInputSchema);
    return withTenant(auth.tenantId, async (tx) => {
      const [t] = await tx.select({ max: tenants.maxCompanies }).from(tenants).where(eq(tenants.id, auth.tenantId));
      const [{ n }] = await tx.select({ n: count() }).from(companies);
      if (n >= t.max) throw new ApiError(402, `Seu plano permite até ${t.max} empresa(s)`);
      if (body.cnpj) {
        const [dup] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.cnpj, body.cnpj));
        if (dup) throw new ApiError(409, "Já existe uma empresa com este CNPJ/CPF");
      }
      const company = await createCompany(tx, { tenantId: auth.tenantId, userId: auth.userId, userName: auth.name }, body);
      return Response.json(company, { status: 201 });
    });
  },
  { minRole: "MANAGER" },
);
