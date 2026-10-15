import { hasRole, requireAuth } from "@/lib/auth";
import { ChartView } from "@/components/companies/chart-view";

export const metadata = { title: "Plano de contas" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  return <ChartView companyId={id} canManage={hasRole(auth.role, "MANAGER")} />;
}
