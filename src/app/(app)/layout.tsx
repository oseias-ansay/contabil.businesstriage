/** Layout autenticado: sidebar com módulos do plano + topbar + aviso de natureza informativa. */
import { requireAuth } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { Providers } from "../providers";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { DISCLAIMER } from "@/lib/disclaimer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const tenant = (await getCurrentTenant())!;
  return (
    <Providers>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          tenant={{ name: tenant.name, logoUrl: tenant.logoUrl, modules: tenant.enabledModules }}
          isSuperAdmin={auth.role === "SUPER_ADMIN"}
          canManage={["SUPER_ADMIN", "OWNER"].includes(auth.role)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar userName={auth.name} role={auth.role} />
          <main className="min-h-0 flex-1 overflow-auto">
            {children}
            <p className="mx-6 mb-6 mt-2 border-t pt-3 text-[11px] leading-relaxed text-slate-400">{DISCLAIMER}</p>
          </main>
        </div>
      </div>
    </Providers>
  );
}
