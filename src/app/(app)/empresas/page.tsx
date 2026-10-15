import { requireAuth, hasRole } from "@/lib/auth";
import { CompaniesView } from "@/components/companies/companies-view";

export const metadata = { title: "Empresas" };

export default async function Page() {
  const auth = await requireAuth();
  return <CompaniesView canEdit={hasRole(auth.role, "MANAGER")} />;
}
