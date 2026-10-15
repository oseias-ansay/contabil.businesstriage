/** GET /api/companies/:id/bank — contas que aceitam extrato, importações recentes e totais por status. */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { route } from "@/lib/api";
import { requireCompany } from "@/lib/company-ctx";
import { bankAccountsOf, listImports, requireBankModule } from "@/lib/bank/service";

export const GET = route<{ id: string }>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    await requireBankModule(tx, auth.tenantId);
    const co = await requireCompany(tx, params.id);
    const totals = await tx.execute<{ status: string; n: number }>(sql`select status::text, count(*)::int as n from bank_lines where company_id = ${co.id} group by status`);
    return {
      bankAccounts: await bankAccountsOf(tx, co.id),
      imports: await listImports(tx, co.id),
      totals: Object.fromEntries(totals.rows.map((r) => [r.status, r.n])),
    };
  }),
);
