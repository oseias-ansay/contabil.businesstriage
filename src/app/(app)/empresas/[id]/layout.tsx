/** Cabeçalho da empresa + abas (lançamentos, plano de contas, abertura, fechamento, relatórios). */
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { dmy, formatDoc } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { CompanyTabs } from "@/components/companies/company-tabs";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const auth = await requireAuth();
  const [c] = await withTenant(auth.tenantId, (tx) => tx.select().from(companies).where(eq(companies.id, id)));
  if (!c) notFound();
  return (
    <div className="p-6">
      <Link href="/empresas" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary"><ArrowLeft size={12} /> Empresas</Link>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-semibold">{c.tradeName || c.legalName}</h1>
        {!c.isActive && <Badge>Inativa</Badge>}
        <p className="text-sm text-slate-500">
          {c.tradeName ? `${c.legalName} · ` : ""}{formatDoc(c.cnpj)} · escrituração desde {dmy(c.startDate)}
        </p>
      </div>
      <CompanyTabs companyId={c.id} />
      <div className="mt-4">{children}</div>
    </div>
  );
}
