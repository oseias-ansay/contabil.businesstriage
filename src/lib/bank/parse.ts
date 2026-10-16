/**
 * Leitura de extratos bancários (sem dependências externas).
 *
 *  · OFX 1.x (SGML, sem tags de fechamento) e 2.x (XML), em UTF-8 ou Windows-1252
 *  · CSV/TXT exportado pelos bancos: separador ";", "," ou tab, datas dd/mm/aaaa,
 *    valores em formato brasileiro, com coluna única (com sinal ou D/C) ou débito e crédito separados
 *
 * Saída comum: linhas com data ISO, valor em centavos (positivo = entrada,
 * negativo = saída), histórico e um identificador estável para não importar duas vezes.
 */
import { createHash } from "node:crypto";
import { normalizeText } from "./text";

export { normalizeText };

export type ParsedLine = {
  date: string; // AAAA-MM-DD
  amount: number; // centavos; + entrada, − saída
  description: string;
  document: string | null; // FITID do OFX ou nº do documento do CSV
  dedupeKey: string;
};

export type ParseResult = {
  format: "OFX" | "CSV" | "PDF";
  lines: ParsedLine[];
  warnings: string[];
  bank?: { bankId?: string; accountId?: string; currency?: string };
};

export class BankParseError extends Error {}

// ─────────────────────────── Texto ───────────────────────────

/** Decodifica o arquivo: UTF-8 quando válido, senão Windows-1252 (padrão dos OFX brasileiros). */
export function decodeText(buf: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const head = utf8.slice(0, 400).toUpperCase();
  const declaresLatin = /CHARSET:\s*(1252|8859|ISO-8859-1|WINDOWS-1252)/.test(head) || /ENCODING="?(ISO-8859-1|WINDOWS-1252)/.test(head);
  if (declaresLatin || utf8.includes("�")) return new TextDecoder("windows-1252").decode(buf);
  return utf8.replace(/^﻿/, "");
}

const hash = (...parts: (string | number | null | undefined)[]) => createHash("sha1").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 24);

// ─────────────────────────── Valores e datas ───────────────────────────

/**
 * "1.234,56" · "-1.234,56" · "1.234,56-" · "(1.234,56)" · "R$ 1.234,56" · "1234.56" · "1,234.56" → centavos.
 * Retorna null quando não é um número.
 */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s|R\$| /gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else if (lastDot > lastComma && lastComma >= 0) normalized = s.replace(/,/g, ""); // 1,234.56
  else if (lastDot >= 0 && s.length - lastDot - 1 === 3 && s.split(".").length > 2) normalized = s.replace(/\./g, ""); // 1.234.567
  else normalized = s;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [int, frac = ""] = normalized.split(".");
  const cents = Number(int) * 100 + Math.round(Number(`0.${frac || "0"}`) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

/** "15/01/2026" · "15/01/26" · "2026-01-15" · "15-01-2026" · "20260115…" (OFX) → "2026-01-15". */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})(\d{2})(\d{2})/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ─────────────────────────── OFX ───────────────────────────

const ofxTag = (block: string, tag: string) => {
  const r = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return r ? r[1].trim() : undefined;
};

export function parseOfx(text: string): ParseResult {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
  if (!blocks.length && !/<OFX>/i.test(text)) throw new BankParseError("Arquivo não parece um OFX");
  const warnings: string[] = [];
  const lines: ParsedLine[] = [];
  const seen = new Map<string, number>();
  for (const b of blocks) {
    const date = parseDate(ofxTag(b, "DTPOSTED"));
    const amount = parseAmount(ofxTag(b, "TRNAMT"));
    if (!date || amount == null) {
      warnings.push("Transação sem data ou valor ignorada");
      continue;
    }
    const memo = ofxTag(b, "MEMO");
    const name = ofxTag(b, "NAME");
    const description = [name, memo].filter((x, i, a) => x && a.indexOf(x) === i).join(" — ") || ofxTag(b, "TRNTYPE") || "Sem histórico";
    const fitid = ofxTag(b, "FITID") ?? ofxTag(b, "CHECKNUM") ?? null;
    // FITID identifica a transação; sem ele (ou repetido, o que alguns bancos fazem), usa data+valor+histórico+ordem
    let key = fitid ? `ofx:${fitid}:${date}:${amount}` : `ofx:${hash(date, amount, normalizeText(description))}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    lines.push({ date, amount, description: decodeEntities(description).slice(0, 300), document: fitid, dedupeKey: key });
  }
  if (!lines.length) warnings.push("Nenhuma transação encontrada no arquivo");
  return {
    format: "OFX",
    lines,
    warnings,
    bank: { bankId: ofxTag(text, "BANKID"), accountId: ofxTag(text, "ACCTID"), currency: ofxTag(text, "CURDEF") },
  };
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

// ─────────────────────────── CSV ───────────────────────────

export type CsvMapping = {
  date: number;
  description: number;
  amount?: number; // coluna única com sinal
  debit?: number; // ou colunas separadas
  credit?: number;
  type?: number; // coluna "D"/"C" que dá o sinal da coluna amount
  document?: number;
  hasHeader: boolean;
  delimiter: string;
};

/** Divide uma linha CSV respeitando aspas. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function csvRows(text: string, delimiter?: string) {
  const raw = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const delim =
    delimiter ??
    [";", "\t", ","]
      .map((d) => ({ d, n: raw.slice(0, 20).reduce((s, l) => s + (splitCsvLine(l, d).length > 1 ? 1 : 0), 0), cols: splitCsvLine(raw[0] ?? "", d).length }))
      .sort((a, b) => b.n - a.n || b.cols - a.cols)[0].d;
  return { delimiter: delim, rows: raw.map((l) => splitCsvLine(l, delim)) };
}

const HEAD = {
  date: /^(data|dt|date|data (do )?lan[cç]amento|data mov(imento)?)/,
  description: /(hist[oó]rico|descri[cç][aã]o|lan[cç]amento|memo|detalhe|estabelecimento)/,
  amount: /^(valor|vlr|valor \(r\$\)|amount|montante)/,
  debit: /(d[eé]bito|sa[ií]da|debit)/,
  credit: /(cr[eé]dito|entrada|credit)/,
  type: /^(tipo|d\/c|c\/d|natureza)$/,
  document: /(documento|doc|n[uú]mero|id)/,
  balance: /saldo/,
};

/** Tenta descobrir as colunas pelo cabeçalho; sem cabeçalho, pelo conteúdo. */
export function guessCsvMapping(text: string): CsvMapping & { columns: string[]; sample: string[][] } {
  const { delimiter, rows } = csvRows(text);
  if (!rows.length) throw new BankParseError("Arquivo vazio");
  // procura nas 10 primeiras linhas uma que pareça cabeçalho (alguns bancos põem título antes)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = rows[i].map(normalizeText);
    if (cells.some((c) => HEAD.date.test(c)) && cells.some((c) => HEAD.amount.test(c) || HEAD.debit.test(c) || HEAD.credit.test(c))) {
      headerIdx = i;
      break;
    }
  }
  const body = rows.slice(headerIdx + 1);
  const width = Math.max(...body.slice(0, 30).map((r) => r.length));
  const columns = headerIdx >= 0 ? rows[headerIdx] : Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`);
  const norm = columns.map(normalizeText);
  const find = (re: RegExp, skip: number[] = []) => norm.findIndex((c, i) => !skip.includes(i) && re.test(c) && !HEAD.balance.test(c));

  let date = find(HEAD.date);
  let description = find(HEAD.description, [date]);
  let amount = find(HEAD.amount, [date, description]);
  let debit = amount < 0 ? find(HEAD.debit, [date, description]) : -1;
  let credit = amount < 0 ? find(HEAD.credit, [date, description, debit]) : -1;
  const type = find(HEAD.type, [date, description, amount, debit, credit]);
  const document = find(HEAD.document, [date, description, amount, debit, credit, type]);

  // sem cabeçalho: deduz pelo conteúdo das primeiras linhas
  if (headerIdx < 0) {
    const sample = body.slice(0, 20);
    const score = (i: number, fn: (v: string) => boolean) => sample.filter((r) => r[i] !== undefined && fn(r[i])).length;
    const idx = Array.from({ length: width }, (_, i) => i);
    date = idx.find((i) => score(i, (v) => !!parseDate(v)) >= sample.length * 0.8) ?? -1;
    amount = idx.filter((i) => i !== date).reverse().find((i) => score(i, (v) => parseAmount(v) != null && /\d[.,]\d{2}\b/.test(v)) >= sample.length * 0.8) ?? -1;
    description = idx.filter((i) => i !== date && i !== amount).sort((a, b) => score(b, (v) => /[a-z]/i.test(v)) - score(a, (v) => /[a-z]/i.test(v)))[0] ?? -1;
    debit = credit = -1;
  }

  return {
    delimiter,
    hasHeader: headerIdx >= 0,
    columns,
    sample: body.slice(0, 8),
    date,
    description,
    ...(amount >= 0 ? { amount } : {}),
    ...(debit >= 0 ? { debit } : {}),
    ...(credit >= 0 ? { credit } : {}),
    ...(type >= 0 ? { type } : {}),
    ...(document >= 0 ? { document } : {}),
    // índice do cabeçalho fica implícito: as linhas antes dele são descartadas por não terem data válida
  };
}

export function parseCsv(text: string, mapping: CsvMapping): ParseResult {
  const { rows } = csvRows(text, mapping.delimiter);
  if (mapping.date < 0 || mapping.description < 0) throw new BankParseError("Indique as colunas de data e histórico");
  if (mapping.amount == null && mapping.debit == null && mapping.credit == null) throw new BankParseError("Indique a coluna de valor (ou as de débito e crédito)");
  const warnings: string[] = [];
  const lines: ParsedLine[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const r of rows) {
    const date = parseDate(r[mapping.date]);
    if (!date) {
      skipped++; // cabeçalho, título, linha de saldo…
      continue;
    }
    const desc = (r[mapping.description] ?? "").trim();
    if (/^saldo\b/i.test(normalizeText(desc))) continue; // linhas "SALDO ANTERIOR", "SALDO DO DIA"
    let amount: number | null = null;
    if (mapping.amount != null) {
      amount = parseAmount(r[mapping.amount]);
      const t = mapping.type != null ? normalizeText(r[mapping.type] ?? "") : "";
      if (amount != null && t) {
        if (/^(d|debito|saida)/.test(t)) amount = -Math.abs(amount);
        else if (/^(c|credito|entrada)/.test(t)) amount = Math.abs(amount);
      }
    } else {
      const d = mapping.debit != null ? parseAmount(r[mapping.debit]) : null;
      const c = mapping.credit != null ? parseAmount(r[mapping.credit]) : null;
      if (d || c) amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (amount == null || amount === 0) {
      if (amount == null) skipped++;
      continue;
    }
    const document = mapping.document != null ? (r[mapping.document] ?? "").trim() || null : null;
    let key = `csv:${hash(date, amount, normalizeText(desc), document)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}#${n}`; // duas compras iguais no mesmo dia são legítimas
    lines.push({ date, amount, description: desc.slice(0, 300) || "Sem histórico", document, dedupeKey: key });
  }
  if (!lines.length) warnings.push("Nenhum lançamento reconhecido: confira as colunas escolhidas");
  else if (skipped > 2) warnings.push(`${skipped} linha(s) sem data ou valor foram ignoradas (cabeçalho, títulos ou saldos)`);
  return { format: "CSV", lines, warnings };
}

/** Detecta o formato pelo conteúdo. */
export function detectFormat(text: string): "OFX" | "CSV" {
  return /OFXHEADER|<OFX>|<STMTTRN>/i.test(text.slice(0, 4000)) ? "OFX" : "CSV";
}
