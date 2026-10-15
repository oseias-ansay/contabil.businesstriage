"use client";
/** Empresas do tenant: lista, cadastro (já com plano de contas padrão) e edição. */
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";

type Company = {
  id: string; legalName: string; tradeName: string | null; cnpj: string | null; taxRegime: string;
  fiscalYearStartMonth: number; startDate: string; isActive: boolean;
};
type Row = { company: Company; accountsCount: number; entriesCount: number };

const REGIMES: Record<string, string> = { SIMPLES: "Simples Nacional", PRESUMIDO: "Lucro Presumido", REAL: "Lucro Real", MEI: "MEI", OUTRO: "Outro" };
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function formatDoc(d: string | null) {
  if (!d) return "—";
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}

export function CompaniesView({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["companies"], queryFn: () => api<Row[]>("/api/companies") });
  const [edit, setEdit] = useState<(Partial<Company> & { hasEntries?: boolean }) | null>(null);

  const save = useMutation({
    mutationFn: (b: Partial<Company>) =>
      b.id ? api(`/api/companies/${b.id}`, { method: "PATCH", json: b }) : api("/api/companies", { method: "POST", json: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      setEdit(null);
    },
  });

  const year = new Date().getFullYear();

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Empresas</h1>
          <p className="text-sm text-slate-500">Cada empresa tem plano de contas, lançamentos e períodos próprios.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setEdit({ taxRegime: "SIMPLES", fiscalYearStartMonth: 1, startDate: `${year}-01-01` })}>
            <Plus size={16} /> Nova empresa
          </Button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Empresa</th>
              <th className="px-4 py-2">CNPJ/CPF</th>
              <th className="px-4 py-2">Regime</th>
              <th className="px-4 py-2 text-right">Contas</th>
              <th className="px-4 py-2 text-right">Lançamentos</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Carregando…</td></tr>}
            {!isLoading && data.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Nenhuma empresa cadastrada.</td></tr>
            )}
            {data.map(({ company: c, accountsCount, entriesCount }) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-2">
                  <Link href={`/empresas/${c.id}`} className="font-medium hover:underline">{c.tradeName || c.legalName}</Link>
                  {c.tradeName && <p className="text-xs text-slate-500">{c.legalName}</p>}
                  {!c.isActive && <Badge className="mt-1">Inativa</Badge>}
                </td>
                <td className="px-4 py-2 tabular-nums">{formatDoc(c.cnpj)}</td>
                <td className="px-4 py-2">{REGIMES[c.taxRegime]}</td>
                <td className="px-4 py-2 text-right tabular-nums">{accountsCount}</td>
                <td className="px-4 py-2 text-right tabular-nums">{entriesCount}</td>
                <td className="px-4 py-2 text-right">
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...c, hasEntries: entriesCount > 0 })} aria-label="Editar">
                      <Pencil size={14} /> Editar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)} title={edit.id ? `Editar ${edit.tradeName || edit.legalName}` : "Nova empresa"}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const { hasEntries: _h, ...body } = edit;
              save.mutate(body);
            }}
          >
            <div><Label>Razão social</Label><Input required minLength={2} value={edit.legalName ?? ""} onChange={(e) => setEdit({ ...edit, legalName: e.target.value })} /></div>
            <div><Label>Nome fantasia</Label><Input value={edit.tradeName ?? ""} onChange={(e) => setEdit({ ...edit, tradeName: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>CNPJ ou CPF</Label>
                <Input value={edit.cnpj ?? ""} disabled={edit.hasEntries} onChange={(e) => setEdit({ ...edit, cnpj: e.target.value })} placeholder="Opcional" />
              </div>
              <div>
                <Label>Regime tributário (informativo)</Label>
                <Select className="w-full" value={edit.taxRegime} onChange={(e) => setEdit({ ...edit, taxRegime: e.target.value })}>
                  {Object.entries(REGIMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div>
                <Label>Início da escrituração</Label>
                <Input type="date" required value={edit.startDate ?? ""} disabled={edit.hasEntries} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
              </div>
              <div>
                <Label>Exercício começa em</Label>
                <Select className="w-full" value={edit.fiscalYearStartMonth} onChange={(e) => setEdit({ ...edit, fiscalYearStartMonth: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </Select>
              </div>
            </div>
            {edit.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.isActive ?? true} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
                Empresa ativa (inativa não aceita novos lançamentos)
              </label>
            )}
            {edit.hasEntries && <p className="text-xs text-slate-500">CNPJ e início da escrituração ficam fixos depois do primeiro lançamento.</p>}
            {!edit.id && <p className="text-xs text-slate-500">A empresa será criada com o plano de contas padrão para MPE, que pode ser ajustado depois.</p>}
            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : edit.id ? "Salvar" : "Criar empresa"}</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
