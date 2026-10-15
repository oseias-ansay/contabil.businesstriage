"use client";
/** Lançamentos do mês: lista com partidas, novo lançamento, detalhe e estorno. */
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { brlCents, brlStr, dmy, monthName } from "@/lib/format";
import { toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { accountLabel, findAccount, lastDay, today, useAccounts, type Account } from "./use-accounts";

type Line = { entryId: string; lineNo: number; code: string; name: string; debit: string; credit: string; memo: string | null };
type Entry = { id: string; number: number; entryDate: string; memo: string; source: string; reversesEntryId: string | null; amount: string; reversedBy: number | null; lines: Line[] };
type List = { total: number; page: number; pageSize: number; entries: Entry[] };

const SOURCE: Record<string, string> = { MANUAL: "Manual", OPENING: "Abertura", REVERSAL: "Estorno", BANK_IMPORT: "Extrato", PLATFORM: "Plataforma", CLOSING: "Encerramento" };

export function EntriesView({ companyId, startDate, canOperate }: { companyId: string; startDate: string; canOperate: boolean }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const params = new URLSearchParams({ from: `${month}-01`, to: lastDay(month), page: String(page), ...(q.trim() && { q: q.trim() }) });
  const { data, isLoading } = useQuery({ queryKey: ["entries", companyId, month, q, page], queryFn: () => api<List>(`/api/companies/${companyId}/entries?${params}`) });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Mês</Label>
          <Input type="month" value={month} min={startDate.slice(0, 7)} onChange={(e) => { setMonth(e.target.value || today().slice(0, 7)); setPage(1); }} className="w-44" />
        </div>
        <div className="relative w-full max-w-xs">
          <Label>Buscar</Label>
          <Search size={14} className="absolute bottom-3 left-3 text-slate-400" />
          <Input className="pl-8" placeholder="Histórico ou nº do lançamento" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <p className="mb-2 mr-auto text-sm text-slate-500">{data ? `${data.total} lançamento(s) em ${monthName(month)}` : ""}</p>
        {canOperate && <Button onClick={() => setCreating(true)}><Plus size={16} /> Novo lançamento</Button>}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2">Nº</th>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Histórico</th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Carregando…</td></tr>}
            {data && data.entries.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Nenhum lançamento neste mês.{canOperate && " Use “Novo lançamento” para registrar o primeiro."}</td></tr>
            )}
            {data?.entries.map((e) => (
              <Fragment key={e.id}>
                <tr className={cn("cursor-pointer border-t hover:bg-slate-50", (e.reversedBy || e.reversesEntryId) && "text-slate-500")} onClick={() => toggle(e.id)}>
                  <td className="px-2 py-2 text-slate-400">{open.has(e.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td className="px-3 py-2 tabular-nums">{e.number}</td>
                  <td className="px-3 py-2 tabular-nums">{dmy(e.entryDate)}</td>
                  <td className="px-3 py-2">
                    {e.memo}
                    {e.reversedBy && <Badge className="ml-2">estornado pelo nº {e.reversedBy}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs">{SOURCE[e.source] ?? e.source}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brlStr(e.amount)}</td>
                </tr>
                {open.has(e.id) && (
                  <tr className="bg-slate-50/70">
                    <td />
                    <td colSpan={5} className="px-3 pb-3">
                      <table className="w-full text-xs">
                        <tbody>
                          {e.lines.map((l) => (
                            <tr key={l.lineNo}>
                              <td className="py-1 pr-2 font-mono text-slate-500">{l.code}</td>
                              <td className="py-1">{Number(l.credit) > 0 && <span className="inline-block w-6" />}{l.name}{l.memo && <span className="text-slate-500"> — {l.memo}</span>}</td>
                              <td className="w-28 py-1 text-right tabular-nums">{Number(l.debit) > 0 ? brlStr(l.debit) : ""}</td>
                              <td className="w-28 py-1 text-right tabular-nums">{Number(l.credit) > 0 ? brlStr(l.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button className="mt-1 text-xs text-primary hover:underline" onClick={() => setDetail(e.id)}>Ver detalhes{canOperate && !e.reversedBy && !e.reversesEntryId ? " e estornar" : ""}</button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
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

      {creating && <EntryForm companyId={companyId} startDate={startDate} defaultDate={month === today().slice(0, 7) ? today() : `${month}-01`} onClose={() => setCreating(false)} onSaved={(d) => { setCreating(false); setMonth(d.slice(0, 7)); }} />}
      {detail && <EntryDetail companyId={companyId} entryId={detail} canOperate={canOperate} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ─────────────────────────── Novo lançamento ───────────────────────────

type Draft = { account: string; debit: string; credit: string; memo: string };
const emptyLine = (): Draft => ({ account: "", debit: "", credit: "", memo: "" });

function cents(v: string) {
  try {
    return toCents(v);
  } catch {
    return NaN;
  }
}

function EntryForm({ companyId, startDate, defaultDate, onClose, onSaved }: { companyId: string; startDate: string; defaultDate: string; onClose: () => void; onSaved: (date: string) => void }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts(companyId);
  const analytic = useMemo(() => accounts.filter((a) => a.isAnalytic && a.isActive), [accounts]);
  const [date, setDate] = useState(defaultDate < startDate ? startDate : defaultDate);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Draft[]>([emptyLine(), emptyLine()]);

  const parsed = lines.map((l) => ({ acc: findAccount(analytic, l.account), d: cents(l.debit), c: cents(l.credit) }));
  const totalD = parsed.reduce((s, p) => s + (Number.isNaN(p.d) ? 0 : p.d), 0);
  const totalC = parsed.reduce((s, p) => s + (Number.isNaN(p.c) ? 0 : p.c), 0);
  const filled = lines.map((l, i) => ({ l, p: parsed[i] })).filter(({ l }) => l.account || l.debit || l.credit);
  const problems: string[] = [];
  filled.forEach(({ l, p }, i) => {
    if (!p.acc) problems.push(`Partida ${i + 1}: escolha uma conta analítica da lista`);
    if (Number.isNaN(p.d) || Number.isNaN(p.c)) problems.push(`Partida ${i + 1}: valor inválido`);
    else if ((p.d > 0) === (p.c > 0)) problems.push(`Partida ${i + 1}: informe débito OU crédito`);
    void l;
  });
  if (filled.length < 2) problems.push("Informe pelo menos duas partidas");
  const diff = totalD - totalC;
  const canSave = !problems.length && diff === 0 && totalD > 0 && memo.trim().length >= 3 && date >= startDate;

  const save = useMutation({
    mutationFn: () =>
      api(`/api/companies/${companyId}/entries`, {
        method: "POST",
        json: {
          entryDate: date,
          memo: memo.trim(),
          lines: filled.map(({ l, p }) => ({ accountId: p.acc!.id, debit: p.d > 0 ? l.debit : undefined, credit: p.c > 0 ? l.credit : undefined, memo: l.memo.trim() || undefined })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", companyId] });
      qc.invalidateQueries({ queryKey: ["accounts", companyId] });
      qc.invalidateQueries({ queryKey: ["periods", companyId] });
      onSaved(date);
    },
  });

  const set = (i: number, patch: Partial<Draft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  /** Completa a última partida com a diferença, para fechar o lançamento rápido. */
  const balanceLast = () => {
    const i = lines.length - 1;
    if (diff > 0) set(i, { credit: (diff / 100).toFixed(2).replace(".", ","), debit: "" });
    if (diff < 0) set(i, { debit: (-diff / 100).toFixed(2).replace(".", ","), credit: "" });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Novo lançamento" className="max-w-4xl">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
        <datalist id="analytic-accounts">{analytic.map((a) => <option key={a.id} value={accountLabel(a)} />)}</datalist>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div><Label>Data</Label><Input type="date" required value={date} min={startDate} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>Histórico</Label><Input required minLength={3} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Ex.: Pagamento do aluguel de outubro" autoFocus /></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="pb-1">Conta</th><th className="w-32 pb-1 text-right">Débito</th><th className="w-32 pb-1 text-right">Crédito</th><th className="pb-1">Complemento</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = parsed[i];
                const bad = l.account && !p.acc;
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <Input list="analytic-accounts" value={l.account} onChange={(e) => set(i, { account: e.target.value })} placeholder="Código ou nome da conta" className={cn("min-w-64", bad && "border-red-400")} />
                    </td>
                    <td className="py-1 pr-2"><Input inputMode="decimal" className="text-right" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, ...(e.target.value && { credit: "" }) })} placeholder="0,00" /></td>
                    <td className="py-1 pr-2"><Input inputMode="decimal" className="text-right" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, ...(e.target.value && { debit: "" }) })} placeholder="0,00" /></td>
                    <td className="py-1 pr-2"><Input value={l.memo} maxLength={300} onChange={(e) => set(i, { memo: e.target.value })} placeholder="Opcional" /></td>
                    <td className="py-1">
                      {lines.length > 2 && <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remover partida"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="pt-2"><button type="button" className="text-xs font-normal text-primary hover:underline" onClick={() => setLines([...lines, emptyLine()])}>+ Adicionar partida</button></td>
                <td className="pr-4 pt-2 text-right tabular-nums">{brlCents(totalD)}</td>
                <td className="pr-4 pt-2 text-right tabular-nums">{brlCents(totalC)}</td>
                <td className="pt-2" colSpan={2}>
                  {diff === 0 && totalD > 0 ? (
                    <span className="text-xs text-emerald-700">Débitos e créditos conferem</span>
                  ) : diff !== 0 ? (
                    <span className="text-xs text-amber-700">
                      Diferença de {brlCents(Math.abs(diff))} · <button type="button" className="underline" onClick={balanceLast}>completar na última partida</button>
                    </span>
                  ) : null}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {problems.length > 0 && filled.length > 0 && <ul className="list-disc pl-5 text-xs text-slate-500">{problems.slice(0, 3).map((p) => <li key={p}>{p}</li>)}</ul>}
        {save.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={!canSave || save.isPending}>{save.isPending ? "Gravando…" : "Gravar lançamento"}</Button>
        </div>
        <p className="text-xs text-slate-500">Depois de gravado, o lançamento não pode ser alterado: para corrigir, faça o estorno e lance de novo.</p>
      </form>
    </Dialog>
  );
}

// ─────────────────────────── Detalhe e estorno ───────────────────────────

type Detail = Entry & { author: string | null; createdAt: string; reversedBy: { id: string; number: number } | null; reverses: { id: string; number: number } | null; lines: (Line & { accountId: string; costCenter: string | null })[] };

function EntryDetail({ companyId, entryId, canOperate, onClose }: { companyId: string; entryId: string; canOperate: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: e } = useQuery({ queryKey: ["entry", entryId], queryFn: () => api<Detail>(`/api/companies/${companyId}/entries/${entryId}`) });
  const [revDate, setRevDate] = useState(today());
  const [revMemo, setRevMemo] = useState("");
  const reverse = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/entries/${entryId}/reverse`, { method: "POST", json: { entryDate: revDate, memo: revMemo.trim() || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", companyId] });
      qc.invalidateQueries({ queryKey: ["entry", entryId] });
    },
  });
  const canReverse = canOperate && e && !e.reversedBy && !e.reverses;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={e ? `Lançamento nº ${e.number}` : "Lançamento"} className="max-w-3xl">
      {!e ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : (
        <div className="grid gap-4 text-sm">
          <div className="grid gap-1 sm:grid-cols-3">
            <p><span className="text-xs text-slate-500">Data</span><br />{dmy(e.entryDate)}</p>
            <p><span className="text-xs text-slate-500">Origem</span><br />{SOURCE[e.source] ?? e.source}</p>
            <p><span className="text-xs text-slate-500">Gravado por</span><br />{e.author ?? "Sistema"} em {new Date(e.createdAt).toLocaleString("pt-BR")}</p>
          </div>
          <p><span className="text-xs text-slate-500">Histórico</span><br />{e.memo}</p>
          {e.reverses && <p className="rounded-lg bg-slate-50 p-2 text-xs">Este lançamento estorna o nº {e.reverses.number}.</p>}
          {e.reversedBy && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Estornado pelo lançamento nº {e.reversedBy.number}.</p>}
          <table className="w-full">
            <thead className="text-left text-xs text-slate-500"><tr><th className="pb-1">Conta</th><th className="pb-1 text-right">Débito</th><th className="pb-1 text-right">Crédito</th></tr></thead>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.lineNo} className="border-t">
                  <td className="py-1.5"><span className="font-mono text-xs text-slate-500">{l.code}</span> {l.name}{l.memo && <span className="text-xs text-slate-500"> — {l.memo}</span>}</td>
                  <td className="py-1.5 text-right tabular-nums">{Number(l.debit) > 0 ? brlStr(l.debit) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{Number(l.credit) > 0 ? brlStr(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {canReverse && (
            <fieldset className="grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-xs text-slate-500">Estornar</legend>
              <p className="text-xs text-slate-500">Cria um novo lançamento com débitos e créditos invertidos. O original continua no livro, marcado como estornado.</p>
              <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                <Input type="date" value={revDate} onChange={(ev) => setRevDate(ev.target.value)} />
                <Input value={revMemo} onChange={(ev) => setRevMemo(ev.target.value)} placeholder={`Estorno do lançamento nº ${e.number} — ${e.memo}`.slice(0, 80)} />
              </div>
              {reverse.error && <p className="text-sm text-red-600">{(reverse.error as Error).message}</p>}
              <Button variant="danger" className="justify-self-start" disabled={reverse.isPending} onClick={() => reverse.mutate()}><RotateCcw size={14} /> Estornar lançamento</Button>
            </fieldset>
          )}
        </div>
      )}
    </Dialog>
  );
}

export type { Account };
