/** Painel inicial: empresas do tenant e o que já dá para fazer nesta fase. */
import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { ArrowRight, Landmark } from "lucide-react";
import { withTenant } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Painel" };

export default async function PainelPage() {
  const auth = await requireAuth();
  const rows = await withTenant(auth.tenantId, (tx) =>
    tx
      .select({
        id: companies.id,
        legalName: companies.legalName,
        tradeName: companies.tradeName,
        isActive: companies.isActive,
        startDate: companies.startDate,
        entries: sql<number>`(select count(*)::int from journal_entries e where e.company_id = companies.id)`,
        lastEntry: sql<string | null>`(select max(entry_date)::text from journal_entries e where e.company_id = companies.id)`,
      })
      .from(companies)
      .orderBy(asc(companies.legalName)),
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Olá, {auth.name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">Visão geral das empresas contabilizadas nesta conta.</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <Landmark className="text-primary" />
            <p className="font-medium">Nenhuma empresa cadastrada ainda</p>
            <p className="max-w-xl text-sm text-slate-500">
              Cadastre a primeira empresa: ela já nasce com o plano de contas padrão para micro e pequenas empresas, pronto para receber lançamentos.
            </p>
            <Link href="/empresas" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Cadastrar empresa <ArrowRight size={14} />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Empresas</CardTitle>
            <Link href="/empresas" className="text-xs text-primary hover:underline">Gerenciar</Link>
          </CardHeader>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2">Empresa</th>
                <th className="px-5 py-2">Início da escrituração</th>
                <th className="px-5 py-2 text-right">Lançamentos</th>
                <th className="px-5 py-2">Último lançamento</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-5 py-2">
                    <Link href={`/empresas/${c.id}`} className="font-medium hover:underline">{c.tradeName || c.legalName}</Link>
                    {!c.isActive && <Badge className="ml-2">Inativa</Badge>}
                  </td>
                  <td className="px-5 py-2">{fmtDate(c.startDate)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{c.entries}</td>
                  <td className="px-5 py-2">{c.lastEntry ? fmtDate(c.lastEntry) : "—"}</td>
                  <td className="px-5 py-2 text-right"><Link href={`/empresas/${c.id}`} className="text-xs text-primary hover:underline">Plano de contas</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

const fmtDate = (iso: string) => iso.split("-").reverse().join("/");
