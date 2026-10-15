import { hasRole, requireAuth } from "@/lib/auth";
import { ClosingView } from "@/components/companies/closing-view";

export const metadata = { title: "Fechamento" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  return <ClosingView companyId={id} canManage={hasRole(auth.role, "MANAGER")} />;
}
