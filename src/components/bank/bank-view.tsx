"use client";
/**
 * Extratos: importar arquivo (OFX/CSV), classificar os movimentos (sugestão por regra
 * ou histórico), lançar em lote, desfazer, ignorar e gerenciar regras.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, FileUp, ListChecks, Plus, RotateCcw, Search, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { brlCents, brlStr, dmy } from "@/lib/format";
import { toCents } from "@/lib/money";
import { patternFromDescription } from "@/lib/bank/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { accountLabel, findAccount, useAccounts, type Account } from "@/components/companies/use-accounts";

type BankAccount = { id: string; code: string; name: string };
type Overview = {
  bankAccounts: BankAccount[];
  imports: { import: { id: string; bankAccountId: string; fileName: string; format: string; firstDate: string | null; lastDate: string | null; linesTotal: number; linesNew: number; createdAt: string }; bankCode: string; bankName: string; pending: number; posted: number }[];
  totals: Partial<Record<"PENDING" | "POSTED" | "IGNORED", number>>;
};
type Line = {
  id: string; lineDate: string; amount: string; description: string; document: string | null; status: string; suggestedBy: string | null;
  accountId: string | null; accountCode: string | null; accountName: string | null; bankCode: string; bankName: string; entryNumber: number | null;
};
type LinesResp = { total: number; inflow: string; outflow: string; page: number; pageSize: number; lines: Line[] };
type Rule = { rule: { id: string; pattern: string; direction: "ANY" | "IN" | "OUT"; bankAccountId: string | null; accountId: string; priority: number; isActive: boolean; hits: number }; accountCode: string; accountName: string };

type Tab = "PENDING" | "POSTED" | "IGNORED" | "rules" | "imports";

export function BankView({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("PENDING");
  const [uploading, setUploading] = useState(false);
  const { data: ov } = useQuery({ queryKey: ["bank", companyId], queryFn: () => api<Overview>(`/api/companies/${companyId}/bank`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["bank", companyId] });
    qc.invalidateQueries({ queryKey: ["bank-lines", companyId] });
    qc.invalidateQueries({ queryKey: ["bank-rules", companyId] });
    qc.invalidateQueries({ queryKey: ["entries", companyId] });
    qc.invalidateQueries({ queryKey: ["accounts", companyId] });
  };

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: "PENDING", label: "A lançar", n: ov?.totals.PENDING ?? 0 },
    { key: "POSTED", label: "Lançados", n: ov?.totals.POSTED ?? 0 },
    { key: "IGNORED", label: "Ignorados", n: ov?.totals.IGNORED ?? 0 },
    { key: "rules", label: "Regras" },
    { key: "imports", label: "Arquivos importados" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap rounded-lg bg-slate-100 p-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.key ? "bg-white font-medium shadow-sm" : "text-slate-600")}>
              {t.label}
              {t.n != null && <span className={cn("ml-1.5 rounded-full px-1.5 text-[11px]", t.key === "PENDING" && t.n ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600")}>{t.n}</span>}
            </button>
          ))}
        </div>
        <Button className="ml-auto" onClick={() => setUploading(true)} disabled={!ov?.bankAccounts.length}><FileUp size={16} /> Importar extrato</Button>
      </div>
      {ov && !ov.bankAccounts.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Nenhuma conta bancária ativa no plano de contas (grupos 1.1.1 ou 2.1.4).</p>}

      {(tab === "PENDING" || tab === "POSTED" || tab === "IGNORED") && <LinesTab key={tab} companyId={companyId} status={tab} bankAccounts={ov?.bankAccounts ?? []} onChange={refresh} />}
      {tab === "rules" && <RulesTab companyId={companyId} bankAccounts={ov?.bankAccounts ?? []} onChange={refresh} />}
      {tab === "imports" && <ImportsTab companyId={companyId} imports={ov?.imports ?? []} canManage={canManage} onChange={refresh} />}

      {uploading && ov && <UploadDialog companyId={companyId} bankAccounts={ov.bankAccounts} lastBankId={ov.imports[0]?.import.bankAccountId} onClose={() => setUploading(false)} onDone={() => { setUploading(false); setTab("PENDING"); refresh(); }} />}
    </div>
  );
}

// ─────────────────────────── Movimentos ───────────────────────────

function LinesTab({ companyId, status, bankAccounts, onChange }: { companyId: string; status: "PENDING" | "POSTED" | "IGNORED"; bankAccounts: BankAccount[]; onChange: () => void }) {
  const [bank, setBank] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkAccount, setBulkAccount] = useState("");
  const [ruleFrom, setRuleFrom] = useState<Line | null>(null);
  const [result, setResult] = useState<{ posted: number; failed: { lineId: string; error: string }[] } | null>(null);
  const { data: accounts = [] } = useAccounts(companyId);
  const analytic = useMemo(() => accounts.filter((a) => a.isAnalytic && a.isActive), [accounts]);

  const params = new URLSearchParams({ status, page: String(page), ...(bank && { bankAccountId: bank }), ...(q.trim() && { q: q.trim() }) });
  const { data, isLoading } = useQuery({ queryKey: ["bank-lines", companyId, status, bank, q, page], queryFn: () => api<LinesResp>(`/api/companies/${companyId}/bank/lines?${params}`) });
  const lines = data?.lines ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const selected = lines.filter((l) => sel.has(l.id));
  const ready = selected.filter((l) => l.accountId);

  const done = () => {
    setSel(new Set());
    onChange();
  };
  const classify = useMutation({ mutationFn: (v: { lineIds: string[]; accountId: string | null }) => api(`/api/companies/${companyId}/bank/lines/classify`, { method: "POST", json: v }), onSuccess: done });
  const ignore = useMutation({ mutationFn: (v: { lineIds: string[]; ignored: boolean }) => api(`/api/companies/${companyId}/bank/lines/ignore`, { method: "POST", json: v }), onSuccess: done });
  const post = useMutation({
    mutationFn: (lineIds: string[]) => api<{ posted: unknown[]; failed: { lineId: string; error: string }[] }>(`/api/companies/${companyId}/bank/lines/post`, { method: "POST", json: { lineIds } }),
    onSuccess: (r) => {
      setResult({ posted: r.posted.length, failed: r.failed });
      done();
    },
  });
  const unpost = useMutation({ mutationFn: (lineId: string) => api(`/api/companies/${companyId}/bank/lines/${lineId}/unpost`, { method: "POST" }), onSuccess: done });
  const busy = classify.isPending || ignore.isPending || post.isPending || unpost.isPending;
  const err = (classify.error ?? ignore.error ?? post.error ?? unpost.error) as Error | null;

  const toggleAll = () => setSel(sel.size === lines.length ? new Set() : new Set(lines.map((l) => l.id)));
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const failedBy = new Map(result?.failed.map((f) => [f.lineId, f.error]));

  return (
    <div className="space-y-3">
      <datalist id="bank-analytic">{analytic.map((a) => <option key={a.id} value={accountLabel(a)} />)}</datalist>
      <div className="flex flex-wrap items-end gap-3">
        {bankAccounts.length > 1 && (
          <div><Label>Conta bancária</Label><Select value={bank} onChange={(e) => { setBank(e.target.value); setPage(1); }} className="w-64"><option value="">Todas</option>{bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select></div>
        )}
        <div className="relative w-full max-w-xs">
          <Label>Buscar no histórico</Label>
          <Search size={14} className="absolute bottom-3 left-3 text-slate-400" />
          <Input className="pl-8" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Ex.: tarifa, pix maria" />
        </div>
        {data && (
          <p className="mb-2 text-sm text-slate-500">
            {data.total} movimento(s) · entradas <span className="text-emerald-700">{brlStr(data.inflow)}</span> · saídas <span className="text-red-700">{brlStr(data.outflow)}</span>
          </p>
        )}
      </div>

      {status === "PENDING" && sel.size > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3 text-sm">
          <span className="font-medium">{sel.size} selecionado(s)</span>
          <Button size="sm" disabled={busy || !ready.length} onClick={() => post.mutate(ready.map((l) => l.id))}><CheckSquare size={14} /> Lançar {ready.length} classificado(s)</Button>
          <span className="mx-1 text-slate-300">|</span>
          <Input list="bank-analytic" value={bulkAccount} onChange={(e) => setBulkAccount(e.target.value)} placeholder="Classificar todos como…" className="h-8 w-72" />
          <Button size="sm" variant="outline" disabled={busy || !findAccount(analytic, bulkAccount)} onClick={() => { classify.mutate({ lineIds: [...sel], accountId: findAccount(analytic, bulkAccount)!.id }); setBulkAccount(""); }}>Aplicar</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => ignore.mutate({ lineIds: [...sel], ignored: true })}>Ignorar</Button>
        </Card>
      )}
      {status === "IGNORED" && sel.size > 0 && (
        <Card className="flex items-center gap-2 p-3 text-sm"><span className="font-medium">{sel.size} selecionado(s)</span><Button size="sm" variant="outline" disabled={busy} onClick={() => ignore.mutate({ lineIds: [...sel], ignored: false })}>Voltar para “A lançar”</Button></Card>
      )}
      {result && (
        <div className={cn("rounded-lg p-3 text-sm", result.failed.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800")}>
          {result.posted} movimento(s) lançado(s).{result.failed.length > 0 && ` ${result.failed.length} não lançado(s): veja o motivo em cada linha.`}
          <button className="ml-2 underline" onClick={() => setResult(null)}>fechar</button>
        </div>
      )}
      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err.message}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {status !== "POSTED" && <th className="w-8 px-3 py-2"><input type="checkbox" checked={!!lines.length && sel.size === lines.length} onChange={toggleAll} aria-label="Selecionar todos" /></th>}
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Histórico do banco</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">{status === "POSTED" ? "Lançado em" : "Contrapartida"}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Carregando…</td></tr>}
            {data && !lines.length && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{status === "PENDING" ? "Nada a lançar. Importe um extrato para começar." : "Nenhum movimento aqui."}</td></tr>
            )}
            {lines.map((l) => {
              const cents = toCents(l.amount);
              return (
                <tr key={l.id} className={cn("border-t align-top", sel.has(l.id) && "bg-primary/5")}>
                  {status !== "POSTED" && <td className="px-3 py-2"><input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} aria-label="Selecionar" /></td>}
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dmy(l.lineDate)}</td>
                  <td className="px-3 py-2">
                    {l.description}
                    <span className="block text-xs text-slate-400">{l.bankCode} {l.bankName}{l.document ? ` · doc. ${l.document}` : ""}</span>
                    {failedBy.get(l.id) && <span className="mt-1 block text-xs text-red-600">{failedBy.get(l.id)}</span>}
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", cents < 0 ? "text-red-700" : "text-emerald-700")}>{brlCents(cents)}</td>
                  <td className="min-w-72 px-3 py-2">
                    {status === "POSTED" ? (
                      <span>{l.accountCode} {l.accountName}<span className="block text-xs text-slate-500">lançamento nº {l.entryNumber}</span></span>
                    ) : (
                      <AccountCell line={l} analytic={analytic} disabled={busy || status === "IGNORED"} onPick={(accountId) => classify.mutate({ lineIds: [l.id], accountId })} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {status === "PENDING" && (
                      <>
                        <button className="mr-3 inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setRuleFrom(l)} title="Criar regra a partir deste movimento"><Wand2 size={12} /> regra</button>
                        <button className="text-xs font-medium text-primary hover:underline disabled:text-slate-300 disabled:no-underline" disabled={!l.accountId || busy} onClick={() => post.mutate([l.id])}>Lançar</button>
                      </>
                    )}
                    {status === "POSTED" && <button className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-red-700" disabled={busy} onClick={() => unpost.mutate(l.id)}><RotateCcw size={12} /> Desfazer</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span className="text-slate-500">página {page} de {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>
      )}
      {status === "POSTED" && <p className="text-xs text-slate-500">Desfazer estorna o lançamento na mesma data e devolve o movimento para “A lançar”.</p>}
      {status === "IGNORED" && <p className="text-xs text-slate-500">Ignore o que não deve virar lançamento, como transferências entre contas já lançadas pelo outro extrato.</p>}

      {ruleFrom && <RuleDialog companyId={companyId} bankAccounts={bankAccounts} fromLine={ruleFrom} onClose={() => setRuleFrom(null)} onSaved={() => { setRuleFrom(null); onChange(); }} />}
    </div>
  );
}

function AccountCell({ line, analytic, disabled, onPick }: { line: Line; analytic: Account[]; disabled: boolean; onPick: (accountId: string | null) => void }) {
  const current = line.accountId ? `${line.accountCode} — ${line.accountName}` : "";
  const [text, setText] = useState(current);
  const [editing, setEditing] = useState(false);
  const value = editing ? text : current;
  const commit = () => {
    setEditing(false);
    if (text === current) return;
    if (!text.trim()) return onPick(null);
    const a = findAccount(analytic, text);
    if (a && a.id !== line.accountId) onPick(a.id);
    else setText(current);
  };
  return (
    <div>
      <Input
        list="bank-analytic"
        value={value}
        disabled={disabled}
        onFocus={() => { setText(current); setEditing(true); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="Escolha a conta"
        className={cn("h-8", !line.accountId && "border-amber-300")}
      />
      {line.suggestedBy && line.suggestedBy !== "USER" && <span className="mt-0.5 block text-[11px] text-slate-500">{line.suggestedBy === "RULE" ? "sugerida por regra" : "sugerida pelo histórico"}</span>}
    </div>
  );
}

// ─────────────────────────── Regras ───────────────────────────

const DIR: Record<string, string> = { ANY: "Entradas e saídas", IN: "Só entradas", OUT: "Só saídas" };

function RulesTab({ companyId, bankAccounts, onChange }: { companyId: string; bankAccounts: BankAccount[]; onChange: () => void }) {
  const { data = [] } = useQuery({ queryKey: ["bank-rules", companyId], queryFn: () => api<Rule[]>(`/api/companies/${companyId}/bank/rules`) });
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api(`/api/companies/${companyId}/bank/rules/${id}`, { method: "DELETE" }), onSuccess: onChange });
  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <p className="mr-auto text-sm text-slate-500">Quando o histórico do banco contém o texto da regra, o movimento já chega classificado. A ordem de avaliação é a prioridade (menor primeiro).</p>
        <Button variant="outline" className="shrink-0" onClick={() => setEdit("new")}><Plus size={16} /> Nova regra</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">Histórico contém</th><th className="px-3 py-2">Vale para</th><th className="px-3 py-2">Contrapartida</th><th className="px-3 py-2 text-right">Prioridade</th><th className="px-3 py-2 text-right">Usos</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {!data.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Nenhuma regra ainda. Crie a partir de um movimento em “A lançar” (botão “regra”).</td></tr>}
            {data.map(({ rule: r, accountCode, accountName }) => (
              <tr key={r.id} className={cn("border-t", !r.isActive && "opacity-50")}>
                <td className="px-3 py-2 font-mono text-xs">{r.pattern}</td>
                <td className="px-3 py-2 text-xs">{DIR[r.direction]}{r.bankAccountId && <span className="block text-slate-500">{bankAccounts.find((b) => b.id === r.bankAccountId)?.name ?? "conta específica"}</span>}</td>
                <td className="px-3 py-2">{accountCode} {accountName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.priority}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.hits}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button className="mr-3 text-xs text-primary hover:underline" onClick={() => setEdit({ rule: r, accountCode, accountName })}>Editar</button>
                  <button className="text-xs text-slate-500 hover:text-red-700" onClick={() => del.mutate(r.id)} aria-label="Excluir regra"><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <RuleDialog companyId={companyId} bankAccounts={bankAccounts} rule={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />}
    </div>
  );
}

function RuleDialog({ companyId, bankAccounts, rule, fromLine, onClose, onSaved }: { companyId: string; bankAccounts: BankAccount[]; rule?: Rule; fromLine?: Line; onClose: () => void; onSaved: () => void }) {
  const { data: accounts = [] } = useAccounts(companyId);
  const analytic = useMemo(() => accounts.filter((a) => a.isAnalytic && a.isActive), [accounts]);
  const initialAccount = rule ? `${rule.accountCode} — ${rule.accountName}` : fromLine?.accountId ? `${fromLine.accountCode} — ${fromLine.accountName}` : "";
  const [pattern, setPattern] = useState(rule?.rule.pattern ?? (fromLine ? patternFromDescription(fromLine.description) : ""));
  const [direction, setDirection] = useState<"ANY" | "IN" | "OUT">(rule?.rule.direction ?? (fromLine ? (toCents(fromLine.amount) > 0 ? "IN" : "OUT") : "ANY"));
  const [bank, setBank] = useState(rule?.rule.bankAccountId ?? "");
  const [account, setAccount] = useState(initialAccount);
  const [priority, setPriority] = useState(rule?.rule.priority ?? 100);
  const [isActive, setIsActive] = useState(rule?.rule.isActive ?? true);
  const acc = findAccount(analytic, account);
  const save = useMutation({
    mutationFn: () =>
      api<{ applied: number }>(rule ? `/api/companies/${companyId}/bank/rules/${rule.rule.id}` : `/api/companies/${companyId}/bank/rules`, {
        method: rule ? "PATCH" : "POST",
        json: { pattern, direction, bankAccountId: bank || null, accountId: acc?.id, priority, isActive, applyToPending: true },
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={rule ? "Editar regra" : "Nova regra de classificação"}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (acc) save.mutate(); }}>
        {fromLine && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Movimento: {fromLine.description} · {brlStr(fromLine.amount)}</p>}
        <div>
          <Label>Quando o histórico contiver</Label>
          <Input required minLength={3} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Ex.: tarifa, copel, padaria central" autoFocus />
          <p className="mt-1 text-xs text-slate-500">O histórico precisa ter todas estas palavras, em qualquer ordem. Maiúsculas e acentos não fazem diferença; evite números, que mudam a cada movimento.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Vale para</Label><Select className="w-full" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>{Object.entries(DIR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label>Conta bancária</Label><Select className="w-full" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Qualquer</option>{bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select></div>
        </div>
        <div>
          <Label>Classificar na conta</Label>
          <datalist id="rule-accounts">{analytic.map((a) => <option key={a.id} value={accountLabel(a)} />)}</datalist>
          <Input list="rule-accounts" required value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Código ou nome da conta analítica" className={cn(account && !acc && "border-red-400")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Prioridade (menor primeiro)</Label><Input type="number" min={1} max={999} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></div>
          <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Ativa</label>
        </div>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button type="submit" disabled={!acc || pattern.trim().length < 3 || save.isPending}>{save.isPending ? "Salvando…" : "Salvar e aplicar aos pendentes"}</Button>
        <p className="text-xs text-slate-500">Movimentos que você classificou à mão não são alterados pela regra.</p>
      </form>
    </Dialog>
  );
}

// ─────────────────────────── Arquivos importados ───────────────────────────

function ImportsTab({ companyId, imports, canManage, onChange }: { companyId: string; imports: Overview["imports"]; canManage: boolean; onChange: () => void }) {
  const del = useMutation({ mutationFn: (id: string) => api(`/api/companies/${companyId}/bank/imports/${id}`, { method: "DELETE" }), onSuccess: onChange });
  return (
    <div className="space-y-3">
      {del.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(del.error as Error).message}</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">Arquivo</th><th className="px-3 py-2">Conta</th><th className="px-3 py-2">Período</th><th className="px-3 py-2 text-right">Lidos</th><th className="px-3 py-2 text-right">Novos</th><th className="px-3 py-2 text-right">A lançar</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {!imports.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Nenhum extrato importado.</td></tr>}
            {imports.map(({ import: i, bankCode, bankName, pending, posted }) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-2">{i.fileName}<span className="block text-xs text-slate-500">{i.format} · {new Date(i.createdAt).toLocaleString("pt-BR")}</span></td>
                <td className="px-3 py-2">{bankCode} {bankName}</td>
                <td className="whitespace-nowrap px-3 py-2">{dmy(i.firstDate)} a {dmy(i.lastDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.linesTotal}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.linesNew}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pending}</td>
                <td className="px-3 py-2 text-right">
                  {canManage && posted === 0 && <button className="text-xs text-slate-500 hover:text-red-700" disabled={del.isPending} onClick={() => del.mutate(i.id)}>Excluir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-500">“Novos” desconta os movimentos que já tinham vindo em outro arquivo: dá para importar extratos com períodos sobrepostos sem duplicar. Só é possível excluir uma importação sem movimentos lançados.</p>
    </div>
  );
}

// ─────────────────────────── Envio do arquivo ───────────────────────────

type Mapping = { delimiter: string; hasHeader: boolean; date: number; description: number; amount?: number; debit?: number; credit?: number; type?: number; document?: number };
type Preview = {
  fileName: string; format: "OFX" | "CSV" | "PDF"; warnings: string[]; bank?: { bankId?: string; accountId?: string };
  count: number; firstDate: string | null; lastDate: string | null; inflow: number; outflow: number;
  lines: { date: string; amount: number; description: string }[];
  csv: { mapping: Mapping; columns: string[]; sample: string[][] } | null;
};

function UploadDialog({ companyId, bankAccounts, lastBankId, onClose, onDone }: { companyId: string; bankAccounts: BankAccount[]; lastBankId?: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  // padrão: a conta do último extrato importado; senão, a primeira que não é o caixa
  const [bank, setBank] = useState(
    (lastBankId && bankAccounts.some((b) => b.id === lastBankId) ? lastBankId : undefined) ?? bankAccounts.find((b) => !/caixa/i.test(b.name))?.id ?? bankAccounts[0]?.id ?? "",
  );
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ new: number; duplicates: number; suggested: number } | null>(null);

  const send = async (path: string, f: File, m: Mapping | null, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.append("file", f);
    if (m) fd.append("mapping", JSON.stringify(m));
    if (pdfPassword && /\.pdf$/i.test(f.name)) fd.append("pdfPassword", pdfPassword);
    for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
    return api<unknown>(`/api/companies/${companyId}/bank/${path}`, { method: "POST", body: fd });
  };
  const runPreview = async (f: File, m: Mapping | null) => {
    setBusy(true);
    setErr(null);
    try {
      const p = (await send("preview", f, m)) as Preview;
      setPreview(p);
      if (p.csv && !m) setMapping(p.csv.mapping);
    } catch (e) {
      setErr((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      setDone((await send("imports", file, preview?.format === "CSV" ? mapping : null, { bankAccountId: bank })) as { new: number; duplicates: number; suggested: number });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const colSelect = (key: keyof Mapping, label: string, optional = true) =>
    preview?.csv && mapping ? (
      <div>
        <Label>{label}</Label>
        <Select
          className="w-full"
          value={mapping[key] == null ? "" : String(mapping[key])}
          onChange={(e) => {
            const v = e.target.value === "" ? undefined : Number(e.target.value);
            const next = { ...mapping, [key]: v } as Mapping;
            if (key === "amount" && v != null) { next.debit = undefined; next.credit = undefined; }
            if ((key === "debit" || key === "credit") && v != null) next.amount = undefined;
            setMapping(next);
            if (file) runPreview(file, next);
          }}
        >
          {optional && <option value="">—</option>}
          {preview.csv.columns.map((c, i) => <option key={i} value={i}>{c || `Coluna ${i + 1}`}</option>)}
        </Select>
      </div>
    ) : null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Importar extrato" className="max-w-3xl">
      {done ? (
        <div className="grid gap-3 text-sm">
          <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
            {done.new} movimento(s) novo(s) importado(s){done.duplicates ? `; ${done.duplicates} já tinham sido importados antes e foram ignorados` : ""}. {done.suggested} já chegaram com conta sugerida.
          </p>
          <Button onClick={onDone}><ListChecks size={16} /> Ver movimentos a lançar</Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Conta bancária do extrato</Label>
              <Select className="w-full" value={bank} onChange={(e) => setBank(e.target.value)}>{bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select>
            </div>
            <div>
              <Label>Arquivo OFX, CSV ou PDF (até 10 MB)</Label>
              <Input type="file" accept=".ofx,.qfx,.csv,.txt,.pdf" className="pt-2" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setMapping(null); setPreview(null); if (f) runPreview(f, null); }} />
            </div>
          </div>

          {file && /\.pdf$/i.test(file.name) && (
            <div className="grid gap-2 rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
              <p>PDF: a leitura reconhece as colunas pela posição na página. Confira a prévia antes de importar; se algo vier errado, prefira o OFX do mesmo período.</p>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label>Senha do PDF (se houver)</Label>
                  <Input type="password" autoComplete="off" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="ex.: números do CPF/CNPJ" className="w-56" />
                </div>
                <Button variant="outline" disabled={busy} onClick={() => runPreview(file, null)}>Ler de novo</Button>
              </div>
              <p className="text-slate-500">A senha só é usada para abrir o arquivo agora; não fica gravada.</p>
            </div>
          )}

          {preview?.csv && mapping && (
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-xs text-slate-500">Colunas do CSV (confira a leitura abaixo)</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {colSelect("date", "Data", false)}
                {colSelect("description", "Histórico", false)}
                {colSelect("amount", "Valor (com sinal)")}
                {colSelect("debit", "Débito / saída")}
                {colSelect("credit", "Crédito / entrada")}
                {colSelect("type", "Coluna D/C")}
              </div>
            </fieldset>
          )}

          {busy && <p className="text-sm text-slate-500">Lendo o arquivo…</p>}
          {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          {preview && !busy && (
            <div className="grid gap-2">
              <p className="text-sm">
                <b>{preview.count}</b> movimento(s) de {dmy(preview.firstDate)} a {dmy(preview.lastDate)} · entradas <span className="text-emerald-700">{brlCents(preview.inflow)}</span> · saídas <span className="text-red-700">{brlCents(preview.outflow)}</span>
                {preview.bank?.accountId && <span className="text-slate-500"> · conta no arquivo: {preview.bank.bankId} / {preview.bank.accountId}</span>}
              </p>
              {preview.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className="border-t first:border-0">
                        <td className="whitespace-nowrap px-2 py-1 tabular-nums">{dmy(l.date)}</td>
                        <td className="px-2 py-1">{l.description}</td>
                        <td className={cn("whitespace-nowrap px-2 py-1 text-right tabular-nums", l.amount < 0 ? "text-red-700" : "text-emerald-700")}>{brlCents(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.count > preview.lines.length && <p className="text-xs text-slate-500">Mostrando os {preview.lines.length} primeiros.</p>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button disabled={!preview?.count || !bank || busy} onClick={runImport}><FileUp size={16} /> Importar {preview?.count ?? ""} movimento(s)</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

