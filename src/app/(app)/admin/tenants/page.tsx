import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { AdminTenants } from "@/components/admin/admin-tenants";

export const metadata = { title: "Admin Global" };

export default async function Page() {
  const auth = await requireAuth();
  if (auth.role !== "SUPER_ADMIN") redirect("/painel");
  return <AdminTenants />;
}
