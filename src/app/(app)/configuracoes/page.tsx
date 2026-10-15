import { redirect } from "next/navigation";
import { hasRole, requireAuth } from "@/lib/auth";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata = { title: "Configurações" };

export default async function Page() {
  const auth = await requireAuth();
  if (!hasRole(auth.role, "OWNER")) redirect("/painel");
  return <SettingsView />;
}
