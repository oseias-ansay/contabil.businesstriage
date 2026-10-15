"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Gauge, Landmark, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/painel", label: "Painel", icon: Gauge, module: null },
  { href: "/empresas", label: "Empresas e plano de contas", icon: Landmark, module: "ledger" },
] as const;

export function Sidebar({ tenant, isSuperAdmin, canManage }: { tenant: { name: string; logoUrl: string | null; modules: string[] }; isSuperAdmin: boolean; canManage: boolean }) {
  const path = usePathname();
  const item = (href: string, label: string, Icon: typeof Gauge) => (
    <Link
      key={href}
      href={href}
      title={label}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        path.startsWith(href) ? "bg-primary-foreground/15 font-medium text-primary-foreground" : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
      )}
    >
      <Icon size={18} className="shrink-0" />
      <span className="hidden lg:inline">{label}</span>
    </Link>
  );

  return (
    <aside className="flex w-16 shrink-0 flex-col bg-primary p-3 lg:w-64">
      <div className="mb-6 flex min-h-10 flex-col items-center justify-center gap-1 px-1">
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt={tenant.name} className="h-auto max-h-28 w-auto max-w-full object-contain" />
        ) : (
          <span className="hidden truncate text-lg font-bold text-primary-foreground lg:inline">{tenant.name}</span>
        )}
        <span className="hidden text-[11px] uppercase tracking-wider text-primary-foreground/60 lg:inline">Contábil gerencial</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.filter((n) => !n.module || tenant.modules.includes(n.module)).map((n) => item(n.href, n.label, n.icon))}
      </nav>
      <div className="flex flex-col gap-1 border-t border-primary-foreground/10 pt-3">
        {canManage && item("/configuracoes", "Configurações", Settings)}
        {isSuperAdmin && item("/admin/tenants", "Admin Global", ShieldCheck)}
        {!canManage && !isSuperAdmin && <span className="hidden px-3 py-2 text-xs text-primary-foreground/50 lg:flex lg:items-center lg:gap-2"><Building2 size={14} /> {tenant.name}</span>}
      </div>
    </aside>
  );
}
