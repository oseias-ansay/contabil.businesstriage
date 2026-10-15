import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { companies } from "@/db/schema";
import { hasRole, requireAuth } from "@/lib/auth";
import { OpeningView } from "@/components/companies/opening-view";

export const metadata = { title: "Saldos de abertura" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  const [c] = await withTenant(auth.tenantId, (tx) => tx.select({ startDate: companies.startDate }).from(companies).where(eq(companies.id, id)));
  return <OpeningView companyId={id} startDate={c.startDate} canManage={hasRole(auth.role, "MANAGER")} />;
}
