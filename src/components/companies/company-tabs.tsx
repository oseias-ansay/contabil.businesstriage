"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "lancamentos", label: "Lançamentos" },
  { href: "relatorios", label: "Relatórios" },
  { href: "fechamento", label: "Fechamento" },
  { href: "plano-de-contas", label: "Plano de contas" },
  { href: "abertura", label: "Saldos de abertura" },
];

export function CompanyTabs({ companyId }: { companyId: string }) {
  const path = usePathname();
  return (
    <nav className="mt-4 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const href = `/empresas/${companyId}/${t.href}`;
        const active = path.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-primary font-medium text-primary" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
