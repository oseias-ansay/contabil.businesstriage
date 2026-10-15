/** GET /api/companies/:id/accounts — plano de contas da empresa, em ordem de código. */
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { accounts } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route<{ id: string }>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, (tx) =>
    tx
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
      .orderBy(sql`string_to_array(${accounts.code}, '.')::int[]`), // 1.1.2 antes de 1.1.10
  ),
);
