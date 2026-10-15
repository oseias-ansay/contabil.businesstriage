import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { companies } from "@/db/schema";
import { hasRole, requireAuth } from "@/lib/auth";
import { EntriesView } from "@/components/companies/entries-view";

export const metadata = { title: "Lançamentos" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  const [c] = await withTenant(auth.tenantId, (tx) => tx.select({ startDate: companies.startDate, isActive: companies.isActive }).from(companies).where(eq(companies.id, id)));
  return <EntriesView companyId={id} startDate={c.startDate} canOperate={hasRole(auth.role, "OPERATOR") && c.isActive} />;
}
