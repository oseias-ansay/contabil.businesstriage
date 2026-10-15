"use client";
/** Plano de contas em árvore: busca, recolher/expandir e, para gestores, criar subconta, renomear e inativar. */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, Search } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAccounts, type Account } from "./use-accounts";

const TYPE: Record<Account["type"], string> = { ASSET: "Ativo", LIABILITY: "Passivo", EQUITY: "Patrimônio líquido", REVENUE: "Receita", EXPENSE: "Custo/despesa" };
const BALANCE: Record<string, string> = { AC: "Ativo circulante", ANC: "Ativo não circulante", PC: "Passivo circulante", PNC: "Passivo não circulante", PL: "Patrimônio líquido" };
const DRE: Record<string, string> = {
  RECEITA_BRUTA: "Receita bruta", DEDUCOES: "Deduções", CUSTOS: "Custos", DESPESAS_VENDAS: "Despesas com vendas",
  DESPESAS_ADMINISTRATIVAS: "Despesas administrativas", RECEITAS_FINANCEIRAS: "Receitas financeiras", DESPESAS_FINANCEIRAS: "Despesas financeiras",
  OUTRAS_RECEITAS: "Outras receitas", OUTRAS_DESPESAS: "Outras despesas", IR_CSLL: "IRPJ e CSLL",
};

type Edit = { mode: "create"; parent: Account } | { mode: "edit"; account: Account };

export function ChartView({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useAccounts(companyId);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);

  const visible = useMemo(() => {
    const base = showInactive ? data : data.filter((a) => a.isActive);
    const term = q.trim().toLowerCase();
    if (term) {
      // busca: mostra as contas que batem e todas as mães delas
      const hits = base.filter((a) => a.code.startsWith(term) || a.name.toLowerCase().includes(term));
      const keep = new Set<string>();
      for (const h of hits) {
        const parts = h.code.split(".");
        for (let i = 1; i <= parts.length; i++) keep.add(parts.slice(0, i).join("."));
      }
      return base.filter((a) => keep.has(a.code));
    }
    return base.filter((a) => {
      const parts = a.code.split(".");
      for (let i = 1; i < parts.length; i++) if (closed.has(parts.slice(0, i).join("."))) return false;
      return true;
    });
  }, [data, q, closed, showInactive]);

  const toggle = (code: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const save = useMutation({
    mutationFn: (v: { mode: "create"; parentId: string; name: string; isAnalytic: boolean } | { mode: "edit"; id: string; name: string; isActive: boolean }) =>
      v.mode === "create"
        ? api(`/api/companies/${companyId}/accounts`, { method: "POST", json: { parentId: v.parentId, name: v.name, isAnalytic: v.isAnalytic } })
        : api(`/api/companies/${companyId}/accounts/${v.id}`, { method: "PATCH", json: { name: v.name, isActive: v.isActive } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", companyId] });
      setEdit(null);
    },
  });

  const analytic = data.filter((a) => a.isAnalytic && a.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-slate-500">{data.length} contas, {analytic} analíticas ativas</p>
        <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> mostrar inativas</label>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar por código ou nome" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="text-xs text-primary hover:underline" onClick={() => setClosed(new Set(data.filter((a) => a.level === 2).map((a) => a.code)))}>Recolher</button>
        <button className="text-xs text-primary hover:underline" onClick={() => setClosed(new Set())}>Expandir</button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Conta</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Natureza</th>
              <th className="px-4 py-2">Demonstrativo</th>
              {canManage && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Carregando…</td></tr>}
            {visible.map((a) => {
              const isOpen = !closed.has(a.code);
              return (
                <tr key={a.id} className={cn("group border-t", !a.isAnalytic && "bg-slate-50/60", !a.isActive && "opacity-50")}>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-1" style={{ paddingLeft: (a.level - 1) * 18 }}>
                      {a.isAnalytic ? (
                        <span className="w-4" />
                      ) : (
                        <button onClick={() => toggle(a.code)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200" aria-label={isOpen ? "Recolher" : "Expandir"}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                      <span className="w-20 shrink-0 font-mono text-xs text-slate-500">{a.code}</span>
                      <span className={cn(!a.isAnalytic && "font-semibold", a.level === 1 && "uppercase")}>{a.name}</span>
                      {a.used && <Badge className="ml-2">movimentada</Badge>}
                      {!a.isActive && <Badge className="ml-2">inativa</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">{TYPE[a.type]}</td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">{a.nature === "DEBIT" ? "Devedora" : "Credora"}</td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">{a.balanceGroup ? `Balanço · ${BALANCE[a.balanceGroup]}` : a.dreGroup ? `DRE · ${DRE[a.dreGroup]}` : "—"}</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-1.5 text-right opacity-0 transition-opacity group-hover:opacity-100">
                      {!a.isAnalytic && a.level >= 2 && a.isActive && (
                        <button className="mr-2 inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setEdit({ mode: "create", parent: a })}><Plus size={12} /> Subconta</button>
                      )}
                      {a.level >= 2 && <button className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline" onClick={() => setEdit({ mode: "edit", account: a })}><Pencil size={12} /> Editar</button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-500">Só as contas analíticas (sem subcontas) recebem lançamentos. Conta movimentada não muda de tipo nem de natureza: para deixar de usá-la, inative.</p>

      {edit && (
        <AccountDialog
          edit={edit}
          pending={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          onClose={() => { setEdit(null); save.reset(); }}
          onSave={(v) => save.mutate(edit.mode === "create" ? { mode: "create", parentId: edit.parent.id, name: v.name, isAnalytic: v.isAnalytic } : { mode: "edit", id: edit.account.id, name: v.name, isActive: v.isActive })}
        />
      )}
    </div>
  );
}

function AccountDialog({ edit, pending, error, onClose, onSave }: { edit: Edit; pending: boolean; error: string | null; onClose: () => void; onSave: (v: { name: string; isAnalytic: boolean; isActive: boolean }) => void }) {
  const [name, setName] = useState(edit.mode === "edit" ? edit.account.name : "");
  const [isAnalytic, setIsAnalytic] = useState(true);
  const [isActive, setIsActive] = useState(edit.mode === "edit" ? edit.account.isActive : true);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={edit.mode === "create" ? `Nova subconta de ${edit.parent.code} ${edit.parent.name}` : `Editar ${edit.account.code}`}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSave({ name: name.trim(), isAnalytic, isActive }); }}>
        <div><Label>Nome</Label><Input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        {edit.mode === "create" ? (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isAnalytic} onChange={(e) => setIsAnalytic(e.target.checked)} /> Analítica (recebe lançamentos)</label>
            <p className="text-xs text-slate-500">O código é gerado automaticamente. Tipo, natureza e linha do demonstrativo seguem a conta-mãe.</p>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Ativa</label>
            {!edit.account.isAnalytic && !isActive && <p className="text-xs text-amber-700">Inativar uma conta sintética inativa também todas as subcontas.</p>}
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
      </form>
    </Dialog>
  );
}
