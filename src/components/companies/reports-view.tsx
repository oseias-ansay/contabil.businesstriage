"use client";
/** Relatórios: DRE, balanço, balancete e razão, com filtros e exportação em PDF. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { brlCents, dmy } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { accountLabel, findAccount, lastDay, today, useAccounts } from "./use-accounts";

type Tab = "dre" | "balanco" | "balancete" | "razao";
const TABS: { key: Tab; label: string }[] = [
  { key: "dre", label: "DRE" },
  { key: "balanco", label: "Balanço" },
  { key: "balancete", label: "Balancete" },
  { key: "razao", label: "Razão" },
];

type DreRow = { kind: "group" | "account" | "total"; key: string; label: string; code?: string; values: number[]; share: number | null };
type Dre = { months: string[]; rows: DreRow[]; netRevenue: number; netIncome: number };
type BRow = { code: string; name: string; level: number; isAnalytic: boolean; amount: number; kind?: "result" };
type Balance = { asOf: string; assets: BRow[]; liabilities: BRow[]; totalAssets: number; totalLiabilitiesEquity: number; difference: number };
type TbRow = { code: string; name: string; level: number; isAnalytic: boolean; opening: number; debits: number; credits: number; closing: number };
type Ledger = { account: { code: string; name: string }; opening: number; debits: number; credits: number; closing: number; lines: { entryId: string; number: number; date: string; memo: string; lineMemo: string | null; counterparts: string; debit: number; credit: number; balance: number }[] };

const pct = (s: number | null) => (s == null ? "" : `${(s * 100).toFixed(1).replace(".", ",")}%`);
const mlabel = (m: string) => `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;

export function ReportsView({ companyId, startDate }: { companyId: string; startDate: string }) {
  const [tab, setTab] = useState<Tab>("dre");
  const now = today();
  const year = now.slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01` < startDate ? startDate : `${year}-01-01`);
  const [to, setTo] = useState(lastDay(now.slice(0, 7)));
  const [asOf, setAsOf] = useState(now);
  const [monthly, setMonthly] = useState(true);
  const [accountText, setAccountText] = useState("");
  const { data: accounts = [] } = useAccounts(companyId);
  const account = findAccount(accounts, accountText);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (tab === "balanco") p.set("asOf", asOf);
    else {
      p.set("from", from);
      p.set("to", to);
    }
    if (tab === "dre" && monthly) p.set("monthly", "1");
    if (tab === "razao" && account) p.set("accountId", account.id);
    return p.toString();
  }, [tab, from, to, asOf, monthly, account]);
  const ready = tab !== "razao" || !!account;
  const url = `/api/companies/${companyId}/reports/${tab}?${query}`;
  const { data, isFetching, error } = useQuery({ queryKey: ["report", url], queryFn: () => api<unknown>(url), enabled: ready });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("rounded-md px-4 py-1.5 text-sm", tab === t.key ? "bg-white font-medium shadow-sm" : "text-slate-600")}>{t.label}</button>
          ))}
        </div>
        {tab === "balanco" ? (
          <div><Label>Posição em</Label><Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></div>
        ) : (
          <>
            <div><Label>De</Label><Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
            <div><Label>Até</Label><Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          </>
        )}
        {tab === "dre" && <label className="mb-2.5 flex items-center gap-2 text-sm"><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} /> mês a mês</label>}
        {tab === "razao" && (
          <div className="min-w-72 flex-1">
            <Label>Conta</Label>
            <datalist id="all-accounts">{accounts.map((a) => <option key={a.id} value={accountLabel(a)} />)}</datalist>
            <Input list="all-accounts" value={accountText} onChange={(e) => setAccountText(e.target.value)} placeholder="Código ou nome (sintética soma as subcontas)" />
          </div>
        )}
        <a href={`${url}&format=pdf`} target="_blank" rel="noreferrer" className={cn("ml-auto", !ready && "pointer-events-none opacity-50")}>
          <Button variant="outline" type="button"><FileDown size={16} /> Baixar PDF</Button>
        </a>
      </div>

      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {!ready && <p className="text-sm text-slate-500">Escolha a conta para ver o razão.</p>}
      {ready && !data && isFetching && <p className="text-sm text-slate-500">Calculando…</p>}
      {ready && data != null && (
        <div className={cn(isFetching && "opacity-60")}>
          {tab === "dre" && <DreTable d={data as Dre} />}
          {tab === "balanco" && <BalanceTables d={data as Balance} />}
          {tab === "balancete" && <TrialTable rows={(data as { rows: TbRow[] }).rows} />}
          {tab === "razao" && <LedgerTable d={data as Ledger} />}
        </div>
      )}
    </div>
  );
}

const th = "whitespace-nowrap px-3 py-2 text-right font-medium";
const td = "whitespace-nowrap px-3 py-1.5 text-right tabular-nums";

function DreTable({ d }: { d: Dre }) {
  const cols = d.months;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">Demonstração do resultado</th>
            {cols.map((m) => <th key={m} className={th}>{mlabel(m)}</th>)}
            <th className={th}>Total</th>
            <th className={th}>AV</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.key} className={cn("border-t", r.kind === "total" && "bg-slate-50 font-semibold", r.kind === "group" && "font-medium")}>
              <td className={cn("sticky left-0 z-10 min-w-[280px] px-3 py-1.5", r.kind === "total" ? "bg-slate-50" : "bg-white", r.kind === "account" && "pl-8 text-slate-600")}>{r.kind === "account" && <span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>}{r.label}</td>
              {(cols.length ? r.values : r.values.slice(-1)).map((v, i) => <td key={i} className={cn(td, v < 0 && "text-red-700")}>{brlCents(v, true)}</td>)}
              <td className={cn(td, "text-xs text-slate-500")}>{pct(r.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-3 py-2 text-xs text-slate-500">AV = análise vertical sobre a receita líquida. Valores por competência (data do lançamento).</p>
    </Card>
  );
}

function BalanceTables({ d }: { d: Balance }) {
  const table = (title: string, rows: BRow[]) => (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">{title}</th><th className={th}>Saldo</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.code || `r${i}`} className={cn("border-t", r.level <= 2 && "font-semibold", r.kind === "result" && "italic text-slate-600")}>
              <td className="py-1.5 pr-3" style={{ paddingLeft: 12 + (r.level - 1) * 14 }}>{r.code && <span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>}{r.name}</td>
              <td className={cn(td, r.amount < 0 && "text-red-700")}>{brlCents(r.amount, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-4 xl:grid-cols-2">
        {table("Ativo", d.assets)}
        {table("Passivo e patrimônio líquido", d.liabilities)}
      </div>
      <p className={cn("text-sm", d.difference ? "text-red-700" : "text-emerald-700")}>
        {d.difference ? `Diferença de ${brlCents(Math.abs(d.difference))} entre ativo e passivo + PL: confira os saldos de abertura.` : `Ativo e passivo + PL conferem: ${brlCents(d.totalAssets)} em ${dmy(d.asOf)}.`}
      </p>
    </div>
  );
}

function TrialTable({ rows }: { rows: TbRow[] }) {
  const shown = rows.filter((r) => r.opening || r.debits || r.credits || r.level === 1);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th className="px-3 py-2 text-left font-medium">Conta</th><th className={th}>Saldo anterior</th><th className={th}>Débitos</th><th className={th}>Créditos</th><th className={th}>Saldo atual</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.code} className={cn("border-t", !r.isAnalytic && "font-medium", r.level === 1 && "bg-slate-50")}>
              <td className="py-1.5 pr-3" style={{ paddingLeft: 12 + (r.level - 1) * 14 }}><span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>{r.name}</td>
              <td className={td}>{brlCents(r.opening, true)}</td>
              <td className={td}>{brlCents(r.debits, true)}</td>
              <td className={td}>{brlCents(r.credits, true)}</td>
              <td className={cn(td, r.closing < 0 && "text-red-700")}>{brlCents(r.closing, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-3 py-2 text-xs text-slate-500">Saldos na natureza de cada conta: negativo indica saldo invertido (por exemplo, banco no vermelho).</p>
    </Card>
  );
}

function LedgerTable({ d }: { d: Ledger }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th className="px-3 py-2 text-left font-medium">Data</th><th className="px-3 py-2 text-left font-medium">Nº</th><th className="px-3 py-2 text-left font-medium">Histórico</th><th className="px-3 py-2 text-left font-medium">Contrapartida</th><th className={th}>Débito</th><th className={th}>Crédito</th><th className={th}>Saldo</th></tr>
        </thead>
        <tbody>
          <tr className="border-t text-slate-500"><td className="px-3 py-1.5" colSpan={6}>Saldo anterior</td><td className={td}>{brlCents(d.opening)}</td></tr>
          {d.lines.map((l, i) => (
            <tr key={`${l.entryId}-${i}`} className="border-t">
              <td className="px-3 py-1.5 tabular-nums">{dmy(l.date)}</td>
              <td className="px-3 py-1.5 tabular-nums">{l.number}</td>
              <td className="px-3 py-1.5">{l.memo}{l.lineMemo && <span className="text-slate-500"> — {l.lineMemo}</span>}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{l.counterparts}</td>
              <td className={td}>{brlCents(l.debit, true)}</td>
              <td className={td}>{brlCents(l.credit, true)}</td>
              <td className={cn(td, l.balance < 0 && "text-red-700")}>{brlCents(l.balance)}</td>
            </tr>
          ))}
          <tr className="border-t bg-slate-50 font-semibold"><td className="px-3 py-1.5" colSpan={4}>Totais e saldo final</td><td className={td}>{brlCents(d.debits)}</td><td className={td}>{brlCents(d.credits)}</td><td className={td}>{brlCents(d.closing)}</td></tr>
        </tbody>
      </table>
      {d.lines.length === 0 && <p className="border-t px-3 py-3 text-sm text-slate-500">Sem movimento no período.</p>}
    </Card>
  );
}
