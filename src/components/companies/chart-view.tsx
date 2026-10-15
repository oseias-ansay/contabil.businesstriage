"use client";
/** Plano de contas da empresa em árvore, com busca e recolhimento por grupo. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Search } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDoc } from "./companies-view";

type Acc = {
  id: string; parentId: string | null; code: string; name: string; level: number;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; nature: "DEBIT" | "CREDIT";
  isAnalytic: boolean; balanceGroup: string | null; dreGroup: string | null; isActive: boolean; used: boolean;
};

const TYPE: Record<Acc["type"], string> = { ASSET: "Ativo", LIABILITY: "Passivo", EQUITY: "Patrimônio líquido", REVENUE: "Receita", EXPENSE: "Custo/despesa" };
const BALANCE: Record<string, string> = { AC: "Ativo circulante", ANC: "Ativo não circulante", PC: "Passivo circulante", PNC: "Passivo não circulante", PL: "Patrimônio líquido" };
const DRE: Record<string, string> = {
  RECEITA_BRUTA: "Receita bruta", DEDUCOES: "Deduções", CUSTOS: "Custos", DESPESAS_VENDAS: "Despesas com vendas",
  DESPESAS_ADMINISTRATIVAS: "Despesas administrativas", RECEITAS_FINANCEIRAS: "Receitas financeiras", DESPESAS_FINANCEIRAS: "Despesas financeiras",
  OUTRAS_RECEITAS: "Outras receitas", OUTRAS_DESPESAS: "Outras despesas", IR_CSLL: "IRPJ e CSLL",
};

export function ChartView({ company }: { company: { id: string; name: string; legalName: string; cnpj: string | null; taxRegime: string; startDate: string } }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["accounts", company.id], queryFn: () => api<Acc[]>(`/api/companies/${company.id}/accounts`) });
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term) {
      // busca: mostra as contas que batem e todas as mães delas
      const hits = data.filter((a) => a.code.startsWith(term) || a.name.toLowerCase().includes(term));
      const keep = new Set<string>();
      for (const h of hits) {
        const parts = h.code.split(".");
        for (let i = 1; i <= parts.length; i++) keep.add(parts.slice(0, i).join("."));
      }
      return data.filter((a) => keep.has(a.code));
    }
    return data.filter((a) => {
      const parts = a.code.split(".");
      for (let i = 1; i < parts.length; i++) if (closed.has(parts.slice(0, i).join("."))) return false;
      return true;
    });
  }, [data, q, closed]);

  const toggle = (code: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const analytic = data.filter((a) => a.isAnalytic).length;

  return (
    <div className="space-y-4 p-6">
      <div>
        <Link href="/empresas" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary"><ArrowLeft size={12} /> Empresas</Link>
        <h1 className="mt-1 text-xl font-semibold">{company.name}</h1>
        <p className="text-sm text-slate-500">
          {company.legalName} · {formatDoc(company.cnpj)} · escrituração desde {company.startDate.split("-").reverse().join("/")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-semibold">Plano de contas <span className="text-sm font-normal text-slate-500">· {data.length} contas, {analytic} analíticas</span></h2>
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
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">Carregando…</td></tr>}
            {visible.map((a) => {
              const isOpen = !closed.has(a.code);
              return (
                <tr key={a.id} className={cn("border-t", !a.isAnalytic && "bg-slate-50/60", !a.isActive && "opacity-50")}>
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
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">{TYPE[a.type]}</td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">{a.nature === "DEBIT" ? "Devedora" : "Credora"}</td>
                  <td className="px-4 py-1.5 text-xs text-slate-600">
                    {a.balanceGroup ? `Balanço · ${BALANCE[a.balanceGroup]}` : a.dreGroup ? `DRE · ${DRE[a.dreGroup]}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-500">Só as contas analíticas (sem subcontas) recebem lançamentos. A edição do plano de contas chega na próxima fase.</p>
    </div>
  );
}
