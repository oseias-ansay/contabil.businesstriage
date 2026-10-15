import { redirect } from "next/navigation";
import { hasRole, requireAuth } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { BankView } from "@/components/bank/bank-view";

export const metadata = { title: "Extratos" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  const tenant = await getCurrentTenant();
  if (!tenant?.enabledModules.includes("bank")) redirect(`/empresas/${id}/lancamentos`);
  if (!hasRole(auth.role, "OPERATOR")) redirect(`/empresas/${id}/relatorios`);
  return <BankView companyId={id} canManage={hasRole(auth.role, "MANAGER")} />;
}
