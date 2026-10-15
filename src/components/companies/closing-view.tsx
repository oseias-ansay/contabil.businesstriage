"use client";
/** Fechamento mensal: meses com status, conferências do mês escolhido, fechar e reabrir. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle, Lock, LockOpen } from "lucide-react";
import { api, HttpError } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { monthName } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Month = { month: string; status: "OPEN" | "CLOSED"; entries: number; closedAt: string | null };
type Item = { key: string; label: string; ok: boolean; blocking: boolean; detail?: string };

export function ClosingView({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: months = [] } = useQuery({ queryKey: ["periods", companyId], queryFn: () => api<Month[]>(`/api/companies/${companyId}/periods`) });
  const [sel, setSel] = useState<string | null>(null);
  const current = months.find((m) => m.month === sel) ?? months.find((m) => m.status === "OPEN" && m.entries > 0) ?? months[0];
  const { data: items, isFetching } = useQuery({
    queryKey: ["checklist", companyId, current?.month],
    queryFn: () => api<Item[]>(`/api/companies/${companyId}/periods?checklist=${current!.month}`),
    enabled: !!current && current.status === "OPEN",
  });
  const [needConfirm, setNeedConfirm] = useState(false);

  const act = useMutation({
    mutationFn: (v: { status: "OPEN" | "CLOSED"; acceptWarnings?: boolean }) => api(`/api/companies/${companyId}/periods`, { method: "POST", json: { competence: current!.month, ...v } }),
    onSuccess: () => {
      setNeedConfirm(false);
      qc.invalidateQueries({ queryKey: ["periods", companyId] });
      qc.invalidateQueries({ queryKey: ["checklist", companyId] });
    },
    onError: (e) => {
      if (e instanceof HttpError && e.status === 409) setNeedConfirm(true);
    },
  });

  const warnings = (items ?? []).filter((i) => !i.ok && !i.blocking);
  const blocked = (items ?? []).some((i) => !i.ok && i.blocking);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Meses</CardTitle></CardHeader>
        <ul className="max-h-[520px] overflow-y-auto">
          {months.map((m) => (
            <li key={m.month}>
              <button
                onClick={() => { setSel(m.month); setNeedConfirm(false); act.reset(); }}
                className={cn("flex w-full items-center gap-2 border-b px-5 py-2.5 text-left text-sm last:border-0 hover:bg-slate-50", current?.month === m.month && "bg-primary/5")}
              >
                {m.status === "CLOSED" ? <Lock size={14} className="text-slate-500" /> : <LockOpen size={14} className="text-emerald-600" />}
                <span className="mr-auto capitalize">{monthName(m.month)}</span>
                <span className="text-xs text-slate-500">{m.entries} lanç.</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{monthName(current.month)}</CardTitle>
            <Badge color={current.status === "CLOSED" ? "#64748B" : "#10B981"}>{current.status === "CLOSED" ? "Fechado" : "Aberto"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {current.status === "CLOSED" ? (
              <>
                <p className="text-sm text-slate-600">
                  Mês fechado{current.closedAt ? ` em ${new Date(current.closedAt).toLocaleString("pt-BR")}` : ""}. Nenhum lançamento pode entrar com data deste mês.
                </p>
                {canManage && (
                  <>
                    <p className="text-xs text-slate-500">Reabrir fica registrado na auditoria. Use só para corrigir algo que ficou de fora, e feche de novo em seguida.</p>
                    <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ status: "OPEN" })}><LockOpen size={14} /> Reabrir o mês</Button>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">Conferências antes de fechar:</p>
                <ul className="space-y-2">
                  {isFetching && !items && <li className="text-sm text-slate-500">Conferindo…</li>}
                  {items?.map((i) => (
                    <li key={i.key} className="flex gap-2 text-sm">
                      {i.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : i.blocking ? <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />}
                      <span>{i.label}{i.detail && <span className="block text-xs text-slate-500">{i.detail}</span>}</span>
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <>
                    {needConfirm && warnings.length > 0 && (
                      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                        Há {warnings.length} aviso(s) acima. Se já conferiu, confirme o fechamento.
                        <div className="mt-2"><Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ status: "CLOSED", acceptWarnings: true })}>Fechar mesmo assim</Button></div>
                      </div>
                    )}
                    {!needConfirm && <Button disabled={blocked || act.isPending || !items} onClick={() => act.mutate({ status: "CLOSED", acceptWarnings: false })}><Lock size={14} /> Fechar o mês</Button>}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Só gestores fecham e reabrem meses.</p>
                )}
              </>
            )}
            {act.error && !(act.error instanceof HttpError && act.error.status === 409) && <p className="text-sm text-red-600">{(act.error as Error).message}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
