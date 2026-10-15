/**
 * GET  /api/companies/:id/accounts — plano de contas da empresa, em ordem de código
 * POST /api/companies/:id/accounts { parentId, name, isAnalytic, nature? } — nova subconta (gestor+)
 */
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { accounts } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { accountCreateSchema, createAccount } from "@/lib/ledger";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";

export const GET = route<{ id: string }>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    await requireCompany(tx, params.id);
    return tx
      .select({
        id: accounts.id,
        parentId: accounts.parentId,
        code: accounts.code,
        name: accounts.name,
        level: accounts.level,
        type: accounts.type,
        nature: accounts.nature,
        isAnalytic: accounts.isAnalytic,
        balanceGroup: accounts.balanceGroup,
        dreGroup: accounts.dreGroup,
        isActive: accounts.isActive,
        used: sql<boolean>`exists (select 1 from journal_lines l where l.account_id = accounts.id)`,
      })
      .from(accounts)
      .where(eq(accounts.companyId, params.id))
      .orderBy(sql`string_to_array(${accounts.code}, '.')::int[]`); // 1.1.2 antes de 1.1.10
  }),
);

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, accountCreateSchema);
    return withTenant(auth.tenantId, async (tx) => {
      const co = await requireCompany(tx, params.id);
      return Response.json(await createAccount(tx, ledgerCtx(auth), co.id, body), { status: 201 });
    });
  },
  { minRole: "MANAGER" },
);
