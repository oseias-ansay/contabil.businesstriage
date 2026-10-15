"use client";
/** Saldos de abertura: informa os saldos patrimoniais no início da escrituração e gera um lançamento. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { brlCents, dmy } from "@/lib/format";
import { toCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAccounts } from "./use-accounts";

type Opening = { id: string; number: number; entryDate: string; memo: string };
const safe = (v: string) => {
  try {
    return toCents(v);
  } catch {
    return NaN;
  }
};

export function OpeningView({ companyId, startDate, canManage }: { companyId: string; startDate: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts(companyId);
  const { data: done = [] } = useQuery({ queryKey: ["opening", companyId], queryFn: () => api<Opening[]>(`/api/companies/${companyId}/opening`) });
  const [date, setDate] = useState(startDate);
  const [values, setValues] = useState<Record<string, string>>({});

  // patrimoniais analíticas, exceto a própria contrapartida
  const list = useMemo(() => accounts.filter((a) => a.isAnalytic && a.isActive && ["ASSET", "LIABILITY", "EQUITY"].includes(a.type) && a.code !== "2.3.9.01"), [accounts]);
  const parents = useMemo(() => new Map(accounts.filter((a) => !a.isAnalytic).map((a) => [a.code, a.name])), [accounts]);

  const parsed = list.map((a) => ({ a, v: safe(values[a.id] ?? "") }));
  const invalid = parsed.some((p) => Number.isNaN(p.v));
  const filled = parsed.filter((p) => p.v && !Number.isNaN(p.v));
  // débito líquido: positivo na natureza devedora, negativo na credora
  const net = filled.reduce((s, p) => s + (p.a.nature === "DEBIT" ? p.v : -p.v), 0);
  const assets = filled.filter((p) => p.a.type === "ASSET").reduce((s, p) => s + (p.a.nature === "DEBIT" ? p.v : -p.v), 0);
  const liab = filled.filter((p) => p.a.type !== "ASSET").reduce((s, p) => s + (p.a.nature === "CREDIT" ? p.v : -p.v), 0);

  const save = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/opening`, { method: "POST", json: { entryDate: date, balances: filled.map((p) => ({ accountId: p.a.id, amount: values[p.a.id] })) } }),
    onSuccess: () => {
      setValues({});
      qc.invalidateQueries({ queryKey: ["opening", companyId] });
      qc.invalidateQueries({ queryKey: ["entries", companyId] });
      qc.invalidateQueries({ queryKey: ["accounts", companyId] });
    },
  });

  let lastGroup = "";
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <Card className="overflow-x-auto">
        <CardHeader><CardTitle>Saldos no início da escrituração</CardTitle></CardHeader>
        <table className="w-full text-sm">
          <tbody>
            {list.map((a) => {
              const g = a.code.split(".").slice(0, 3).join(".");
              const head = g !== lastGroup ? (lastGroup = g) : null;
              const v = values[a.id] ?? "";
              return [
                head && (
                  <tr key={`h-${g}`} className="bg-slate-50 text-xs font-medium text-slate-600"><td className="px-4 py-1.5" colSpan={2}>{g} {parents.get(g)}</td></tr>
                ),
                <tr key={a.id} className="border-t">
                  <td className="px-4 py-1"><span className="mr-2 font-mono text-xs text-slate-400">{a.code}</span>{a.name}{a.nature !== (a.type === "ASSET" ? "DEBIT" : "CREDIT") && <span className="ml-1 text-xs text-slate-400">(redutora)</span>}</td>
                  <td className="w-44 px-4 py-1">
                    <Input inputMode="decimal" disabled={!canManage} className={cn("h-8 text-right", Number.isNaN(safe(v)) && "border-red-400")} value={v} placeholder="0,00" onChange={(e) => setValues({ ...values, [a.id]: e.target.value })} />
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Resumo</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span>Ativo</span><span className="tabular-nums">{brlCents(assets)}</span></div>
            <div className="flex justify-between"><span>Passivo + PL informados</span><span className="tabular-nums">{brlCents(liab)}</span></div>
            <div className="flex justify-between border-t pt-2 font-medium"><span>Contrapartida 2.3.9.01</span><span className="tabular-nums">{brlCents(net)}</span></div>
            <p className="text-xs text-slate-500">A diferença entre ativo e passivo + PL vai para a conta 2.3.9.01 (ajustes de implantação), para o balanço fechar desde o primeiro dia. Depois, reclassifique esse valor para capital ou lucros acumulados com um lançamento comum.</p>
            {canManage && (
              <>
                <div><Label>Data do lançamento</Label><Input type="date" value={date} min={startDate} onChange={(e) => setDate(e.target.value)} /></div>
                {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
                {save.isSuccess && <p className="text-sm text-emerald-700">Saldos de abertura lançados.</p>}
                <Button className="w-full" disabled={!filled.length || invalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Gerando…" : "Gerar lançamento de abertura"}</Button>
              </>
            )}
          </CardContent>
        </Card>
        {done.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Já lançados</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {done.map((o) => <p key={o.id}>Nº {o.number} · {dmy(o.entryDate)} · {o.memo}</p>)}
              <p className="text-xs text-slate-500">Para corrigir, estorne o lançamento em <Link href={`/empresas/${companyId}/lancamentos`} className="text-primary hover:underline">Lançamentos</Link> e gere de novo.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
