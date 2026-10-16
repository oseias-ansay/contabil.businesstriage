/**
 * Leitura de extrato bancário em PDF (gerado pelo internet banking, com texto selecionável).
 *
 * Não há padrão entre bancos, então a leitura é pela geometria da página:
 *
 *  1. extrai os trechos de texto com posição (pdfjs) e monta as linhas da página;
 *  2. em cada linha separa as "células" pelos espaços largos entre os trechos;
 *  3. acha o cabeçalho da tabela (Data · Histórico · Valor/Débito/Crédito · Saldo) e usa a posição
 *     de cada título para saber a que coluna pertence cada valor; sem cabeçalho, agrupa os valores
 *     pela posição horizontal (1 coluna = valor; 2 = valor e saldo; 3 = débito, crédito e saldo);
 *  4. cada linha com data (ou sem data, abaixo de uma linha datada) e valor vira um movimento;
 *     linhas só com texto logo abaixo complementam o histórico; linhas de saldo e totais são ignoradas.
 *
 * O sinal vem da coluna (débito/crédito), do próprio número ("-", "D", "C", parênteses) ou, quando o
 * banco só usa cor, da variação do saldo impresso na linha; em último caso, de palavras do histórico.
 */
import { createHash } from "node:crypto";
import { BankParseError, parseAmount, type ParseResult, type ParsedLine } from "./parse";
import { normalizeText } from "./text";

export type PdfCell = { text: string; x0: number; x1: number };
export type PdfLine = { page: number; y: number; h: number; cells: PdfCell[] };

// ─────────────────────────── Extração (pdfjs) ───────────────────────────

type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Lê o PDF e devolve as linhas de texto com as células posicionadas. */
export async function pdfLines(data: Uint8Array, password?: string): Promise<PdfLine[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), password: password || undefined, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") {
      throw new BankParseError(password ? "Senha do PDF incorreta" : "Este PDF é protegido por senha. Informe a senha (muitos bancos usam os números do CPF ou CNPJ)");
    }
    throw new BankParseError("Não foi possível abrir o PDF (arquivo danificado ou não é um PDF)");
  }
  const out: PdfLine[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[])
        .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
        .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 8 }));
      out.push(...groupLines(p, items));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/** Junta os trechos em linhas (mesma altura) e as linhas em células (separadas por espaço largo). */
export function groupLines(page: number, items: { str: string; x: number; y: number; w: number; h: number }[]): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; h: number; items: typeof items }[] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.45));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const its = r.items.sort((a, b) => a.x - b.x);
      const cells: PdfCell[] = [];
      for (const it of its) {
        const last = cells.at(-1);
        const gap = last ? it.x - last.x1 : Infinity;
        if (last && gap < Math.max(4, it.h * 0.9)) {
          last.text += (gap > it.h * 0.12 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
          last.x1 = Math.max(last.x1, it.x + it.w);
        } else cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      }
      for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
      return { page, y: r.y, h: r.h, cells: cells.filter((c) => c.text) };
    });
}

// ─────────────────────────── Interpretação ───────────────────────────

const AMOUNT_RE = /^(?:R\$\s?)?[-+]?\(?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s?[-+DC])?$|^(?:R\$\s?)?[-+]?\d+,\d{2}(?:\s?[-+DC])?$/i;
const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?=\s|$)/;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// "02 MAR 2026" · "2 de março de 2026" · "02 mar" (bancos digitais agrupam por dia)
const TEXT_DATE_RE = /^(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?=\s|$|,)/i;
const FULL_DATE_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;

type Kind = "date" | "description" | "document" | "value" | "debit" | "credit" | "balance" | "other";
type Anchor = { kind: Kind; x0: number; x1: number };

function headerKind(text: string): Kind {
  const t = normalizeText(text);
  if (/^(data|dt|dia)\b/.test(t)) return "date";
  if (/saldo/.test(t)) return "balance";
  if (/(debito|saida|retirada)/.test(t)) return "debit";
  if (/(credito|entrada|deposito)/.test(t)) return "credit";
  if (/^(valor|vlr|montante|quantia)/.test(t)) return "value";
  if (/(historico|descricao|lancamento|detalhe|movimentacao|transacao)/.test(t)) return "description";
  if (/(documento|^doc\b|^n[ºo°]?\.? ?doc|^nr\.? ?doc|^numero)/.test(t)) return "document";
  return "other";
}

/** Uma linha é cabeçalho de tabela quando traz "Data" e ao menos um título de valor ou histórico. */
function asHeader(line: PdfLine): Anchor[] | null {
  if (line.cells.length < 3) return null;
  const anchors = line.cells.map((c) => ({ kind: headerKind(c.text), x0: c.x0, x1: c.x1 }));
  const kinds = new Set(anchors.map((a) => a.kind));
  const money = ["value", "debit", "credit", "balance"].some((k) => kinds.has(k as Kind));
  if (!kinds.has("date") || !money || !(kinds.has("description") || kinds.size >= 3)) return null;
  // uma linha de cabeçalho não tem valores
  if (line.cells.some((c) => AMOUNT_RE.test(c.text))) return null;
  return anchors;
}

const SKIP_DESC = /^(saldo|s a l d o|total|sub ?total|resumo|lancamentos futuros|valores? bloqueado)/;
const NEGATIVE_WORDS = /\b(pagamento|pagto|pgto|pix enviado|pix emitido|transf(erencia)? (enviada|para)|ted enviada|doc enviado|tarifa|tar\b|compra|saque|debito|deb\b|aplicacao|iof|juros|boleto pago|envio)/;
const POSITIVE_WORDS = /\b(recebid[oa]|pix recebido|credito|cred\b|deposito|estorno|rendimento|resgate|devolucao|salario|transf(erencia)? recebida|ted recebida)/;

type Amt = { cents: number; signed: boolean; x0: number; x1: number };

function readAmount(text: string, x0: number, x1: number): Amt | null {
  let s = text.trim();
  let signed = /^[-+]|[-+]$|^\(.*\)$/.test(s.replace(/R\$\s?/i, ""));
  let neg = false;
  const dc = s.match(/\s?([DC])$/i);
  if (dc) {
    signed = true;
    neg = dc[1].toUpperCase() === "D";
    s = s.slice(0, -dc[0].length);
  }
  const v = parseAmount(s);
  if (v == null) return null;
  return { cents: dc ? (neg ? -Math.abs(v) : Math.abs(v)) : v, signed, x0, x1 };
}

/** Separa uma célula com vários números colados ("100,00 1.250,00") em células próprias. */
function splitCells(cells: PdfCell[]): PdfCell[] {
  const out: PdfCell[] = [];
  for (const c0 of cells) {
    // "R$ 1,00" → "R$1,00" · "+ 1,00" → "+1,00": o número fica num pedaço só
    const c = { ...c0, text: c0.text.replace(/(^|\s)([+-])\s+(?=R\$|\d)/g, "$1$2").replace(/R\$\s+(?=[-+]?\d)/g, "R$") };
    const parts = c.text.split(" ");
    const tokens: string[] = [];
    for (const p of parts) {
      // "1.234,56 D" → mantém o D/C junto do número
      if (/^[DC+-]$/i.test(p) && tokens.length && AMOUNT_RE.test(tokens.at(-1)!)) tokens[tokens.length - 1] += ` ${p}`;
      else tokens.push(p);
    }
    const amountTail: string[] = [];
    while (tokens.length && AMOUNT_RE.test(tokens.at(-1)!)) amountTail.unshift(tokens.pop()!);
    if (!amountTail.length || (amountTail.length === 1 && !tokens.length)) {
      out.push(c);
      continue;
    }
    // reparte a largura proporcionalmente ao número de caracteres
    const total = c.text.length || 1;
    const per = (c.x1 - c.x0) / total;
    let cursor = c.x0;
    if (tokens.length) {
      const t = tokens.join(" ");
      out.push({ text: t, x0: cursor, x1: cursor + per * t.length });
      cursor += per * (t.length + 1);
    }
    for (const a of amountTail) {
      out.push({ text: a, x0: cursor, x1: cursor + per * a.length });
      cursor += per * (a.length + 1);
    }
  }
  return out;
}

/** Ano de referência do extrato: a data completa mais recente do documento (período ou emissão). */
function referenceDate(lines: PdfLine[]): { y: number; m: number } | null {
  let best: { y: number; m: number; d: number } | null = null;
  for (const l of lines)
    for (const c of l.cells)
      for (const r of c.text.matchAll(FULL_DATE_RE)) {
        const [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
        if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) continue;
        if (!best || y * 10000 + m * 100 + d > best.y * 10000 + best.m * 100 + best.d) best = { y, m, d };
      }
  return best;
}

function isoDate(d: number, m: number, y: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const center = (a: { x0: number; x1: number }) => (a.x0 + a.x1) / 2;

/** Agrupa as posições horizontais (borda direita) dos valores em colunas. */
function clusterColumns(xs: number[], tol = 14): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const x of sorted) {
    const g = groups.at(-1);
    if (g && x - g[g.length - 1] <= tol) g.push(x);
    else groups.push([x]);
  }
  // colunas de verdade aparecem várias vezes; descarta números soltos (ex.: rodapé)
  const min = Math.max(2, Math.floor(xs.length * 0.04));
  return groups.filter((g) => g.length >= min).map((g) => g.reduce((s, x) => s + x, 0) / g.length);
}

type Draft = { date: string; cents: number; signed: boolean; explicit: boolean; balance: number | null; desc: string[]; document: string | null; page: number; y: number; h: number; extra: number };

export function parsePdfLines(raw: PdfLine[]): ParseResult {
  const lines = raw.map((l) => ({ ...l, cells: splitCells(l.cells) }));
  if (!lines.some((l) => l.cells.length)) {
    throw new BankParseError("O PDF não tem texto selecionável (parece digitalizado). Exporte o extrato em OFX, CSV ou um PDF gerado pelo internet banking");
  }
  const ref = referenceDate(lines);
  const warnings: string[] = [];

  // colunas por cabeçalho (cada página pode repetir o seu) ou, sem cabeçalho, pela posição dos valores
  const headerAt = new Map<number, Anchor[]>();
  lines.forEach((l, i) => {
    const h = asHeader(l);
    if (h) headerAt.set(i, h);
  });
  const amountX: number[] = [];
  for (const l of lines) if (l.cells.length >= 2) for (const c of l.cells.slice(1)) if (AMOUNT_RE.test(c.text)) amountX.push(c.x1);
  const fallbackCols = clusterColumns(amountX);
  const fallbackRoles: Kind[] =
    fallbackCols.length >= 3 ? [...Array(fallbackCols.length - 3).fill("other"), "debit", "credit", "balance"] : fallbackCols.length === 2 ? ["value", "balance"] : ["value"];

  const roleOf = (cell: PdfCell, header: Anchor[] | null): Kind => {
    if (header) {
      const money = header.filter((a) => ["value", "debit", "credit", "balance"].includes(a.kind));
      if (money.length) {
        const dist = (a: Anchor) => Math.min(Math.abs(cell.x1 - a.x1), Math.abs(center(cell) - center(a)));
        return money.reduce((b, a) => (dist(a) < dist(b) ? a : b)).kind;
      }
    }
    if (!fallbackCols.length) return "value";
    let best = 0;
    fallbackCols.forEach((x, i) => {
      if (Math.abs(cell.x1 - x) < Math.abs(cell.x1 - fallbackCols[best])) best = i;
    });
    return fallbackRoles[best] ?? "value";
  };

  const drafts: Draft[] = [];
  let header: Anchor[] | null = null;
  let currentDate: string | null = null;
  let prevBalance: number | null = null;
  let inTable = headerAt.size === 0; // sem cabeçalho, a tabela é o documento inteiro
  let yearGuessed = false;
  let sectionSign = 0;

  lines.forEach((line, idx) => {
    const h = headerAt.get(idx);
    if (h) {
      header = h;
      inTable = true;
      return;
    }
    if (!inTable || !line.cells.length) return;

    // data na primeira célula (pode vir colada ao histórico: "02/03 PIX RECEBIDO")
    const cells = [...line.cells];
    let date: string | null = null;
    let dm = cells[0].text.match(DATE_RE);
    if (!dm) {
      const t = cells[0].text.match(TEXT_DATE_RE);
      if (t) dm = Object.assign([t[0], t[1], String(MONTHS.indexOf(t[2].toLowerCase().slice(0, 3)) + 1), t[3]], { index: 0, input: t.input }) as unknown as RegExpMatchArray;
    }
    const dateCol = header ? (header as Anchor[]).find((a) => a.kind === "date") : null;
    const nearDateCol = !dateCol || cells[0].x0 <= dateCol.x1 + 25;
    if (dm && nearDateCol) {
      const d = Number(dm[1]);
      const m = Number(dm[2]);
      let y = dm[3] ? Number(dm[3]) : NaN;
      if (dm[3] && y < 100) y += 2000;
      if (!dm[3]) {
        if (ref) y = m > ref.m ? ref.y - 1 : ref.y;
        else {
          y = new Date().getFullYear();
          yearGuessed = true;
        }
      }
      date = isoDate(d, m, y);
      if (date) {
        const rest = cells[0].text.slice(dm[0].length).trim();
        if (rest) cells[0] = { ...cells[0], text: rest };
        else cells.shift();
      }
    }

    // valores e textos
    let value: Amt | null = null;
    let balance: number | null = null;
    let debit: Amt | null = null;
    let credit: Amt | null = null;
    const texts: string[] = [];
    let document: string | null = null;
    const docCol = header ? (header as Anchor[]).find((a) => a.kind === "document") : null;
    for (const c of cells) {
      const a = AMOUNT_RE.test(c.text) ? readAmount(c.text, c.x0, c.x1) : null;
      if (a) {
        const role = roleOf(c, header);
        if (role === "balance") balance = a.cents;
        else if (role === "debit") debit = a;
        else if (role === "credit") credit = a;
        else if (role === "value") value = value ?? a;
        continue;
      }
      if (docCol && !document && /^[\w./-]{3,}$/.test(c.text) && Math.abs(center(c) - center(docCol)) < 40) {
        document = c.text;
        continue;
      }
      texts.push(c.text);
    }
    const desc = texts.join(" ").trim();
    const nd = normalizeText(desc);

    let tx: Amt | null = null;
    if (debit || credit) {
      const d = debit as Amt | null;
      const c = credit as Amt | null;
      const cents = (c ? Math.abs(c.cents) : 0) - (d ? Math.abs(d.cents) : 0);
      if (cents) tx = { cents, signed: true, x0: 0, x1: 0 };
    } else if (value && (value as Amt).cents !== 0) tx = value;

    if (date && date !== currentDate) sectionSign = 0;
    if (date) currentDate = date;
    // "Total de entradas" / "Total de saídas": os movimentos seguintes, sem sinal, são daquele tipo
    if (/^total (de )?(entradas|creditos|recebimentos)/.test(nd)) sectionSign = 1;
    else if (/^total (de )?(saidas|debitos|pagamentos)/.test(nd)) sectionSign = -1;

    if (SKIP_DESC.test(nd) || /\bsaldo (anterior|do dia|final|inicial|disponivel|em conta|atual)\b/.test(nd)) {
      // linha de saldo: guarda o saldo para deduzir o sinal dos próximos
      const b = balance ?? (tx && /saldo/.test(nd) ? tx.cents : null);
      if (b != null) prevBalance = b;
      return;
    }

    if (tx && currentDate) {
      drafts.push({ date: currentDate, cents: tx.cents, signed: tx.signed, explicit: tx.signed && !(debit || credit), balance, desc: desc ? [desc] : [], document, page: line.page, y: line.y, h: line.h, extra: 0 });
      // sinal pela variação do saldo impresso na linha
      const last = drafts[drafts.length - 1];
      if (!last.signed && sectionSign) {
        last.cents = sectionSign * Math.abs(last.cents);
        last.signed = true;
      }
      if (!last.signed && balance != null && prevBalance != null && Math.abs(balance - prevBalance) === Math.abs(last.cents)) {
        last.cents = balance >= prevBalance ? Math.abs(last.cents) : -Math.abs(last.cents);
        last.signed = true;
      }
      if (balance != null) prevBalance = balance;
      return;
    }

    // texto logo abaixo de um movimento complementa o histórico
    const last = drafts.at(-1);
    if (!tx && !date && desc && last && last.page === line.page && last.y - line.y <= last.h * 2.6 + 2 && last.extra < 3) {
      last.desc.push(desc);
      last.extra++;
      last.y = line.y;
    }
  });

  // banco que marca as saídas ("-", "D" ou parênteses) e deixa as entradas sem marca:
  // número sem marca é entrada
  const marksDebits = drafts.some((d) => d.signed && d.cents < 0 && d.explicit);
  // sinal pelas palavras do histórico quando nada mais indicou
  let byWords = 0;
  let unknown = 0;
  for (const d of drafts) {
    if (d.signed) continue;
    if (marksDebits) {
      d.cents = Math.abs(d.cents);
      continue;
    }
    const t = normalizeText(d.desc.join(" "));
    if (NEGATIVE_WORDS.test(t) && !POSITIVE_WORDS.test(t)) {
      d.cents = -Math.abs(d.cents);
      byWords++;
    } else if (POSITIVE_WORDS.test(t)) {
      d.cents = Math.abs(d.cents);
      byWords++;
    } else unknown++;
  }

  const seen = new Map<string, number>();
  const out: ParsedLine[] = drafts.map((d) => {
    const description = d.desc.join(" ").replace(/\s+/g, " ").trim().slice(0, 300) || "Sem histórico";
    let key = `pdf:${hash(d.date, d.cents, normalizeText(description), d.document)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    return { date: d.date, amount: d.cents, description, document: d.document, dedupeKey: key };
  });

  if (!out.length) warnings.push("Nenhum movimento reconhecido neste PDF. Se for de um banco diferente, envie o OFX ou o CSV do mesmo período");
  if (byWords) warnings.push(`${byWords} movimento(s) sem sinal no PDF tiveram entrada/saída deduzida pelo histórico: confira na prévia`);
  if (unknown) warnings.push(`${unknown} movimento(s) sem indicação de entrada ou saída foram considerados entradas: confira na prévia`);
  if (yearGuessed) warnings.push("O PDF não informa o ano; foi usado o ano atual");
  return { format: "PDF", lines: out, warnings };
}

const hash = (...parts: (string | number | null | undefined)[]) => createHash("sha1").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 24);

export async function parsePdf(data: Uint8Array, password?: string): Promise<ParseResult> {
  return parsePdfLines(await pdfLines(data, password));
}

export const isPdf = (buf: Uint8Array) => buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
