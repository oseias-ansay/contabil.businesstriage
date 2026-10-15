import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { ChartView } from "@/components/companies/chart-view";

export const metadata = { title: "Plano de contas" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const auth = await requireAuth();
  const [c] = await withTenant(auth.tenantId, (tx) => tx.select().from(companies).where(eq(companies.id, id)));
  if (!c) notFound();
  return <ChartView company={{ id: c.id, name: c.tradeName || c.legalName, legalName: c.legalName, cnpj: c.cnpj, taxRegime: c.taxRegime, startDate: c.startDate }} />;
}
