import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { ReportsView } from "@/components/companies/reports-view";

export const metadata = { title: "Relatórios" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  const [c] = await withTenant(auth.tenantId, (tx) => tx.select({ startDate: companies.startDate }).from(companies).where(eq(companies.id, id)));
  return <ReportsView companyId={id} startDate={c.startDate} />;
}
