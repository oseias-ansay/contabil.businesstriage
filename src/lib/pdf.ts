/**
 * PDF dos relatórios (pdfmake, só no servidor). Cada relatório vira uma tabela
 * genérica; cabeçalho com a marca do tenant e rodapé com o aviso de natureza
 * informativa e a numeração das páginas.
 */
import { DISCLAIMER } from "./disclaimer";
import { formatCents } from "./money";
import type { DreRow, LedgerLine, BalanceRow } from "./reports";
import type { TrialBalanceRow } from "./ledger";

export type PdfCell = { text: string; align?: "left" | "right" | "center" };
export type PdfRow = { cells: (string | PdfCell)[]; style?: "group" | "total" | "muted"; indent?: number };
export type PdfTable = { headers: PdfCell[]; widths: (number | "*" | "auto")[]; rows: PdfRow[] };

type Header = { title: string; subtitle: string; companyName: string; companyDoc?: string | null; tenantName: string; color?: string; landscape?: boolean };

export async function renderReportPdf(h: Header, tables: { heading?: string; table: PdfTable }[], note?: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pdfmake");
  const PdfPrinter = mod.default ?? mod;
  const vfs = (await import("pdfmake/build/vfs_fonts.js")) as unknown as Record<string, string> & { default?: Record<string, string> };
  const fonts = vfs.default ?? vfs;
  const b = (f: string) => Buffer.from(fonts[f], "base64");
  const printer = new PdfPrinter({
    Roboto: { normal: b("Roboto-Regular.ttf"), bold: b("Roboto-Medium.ttf"), italics: b("Roboto-Italic.ttf"), bolditalics: b("Roboto-MediumItalic.ttf") },
  });
  const color = h.color ?? "#0F2A44";

  const content: unknown[] = [
    { text: h.companyName, style: "company" },
    ...(h.companyDoc ? [{ text: h.companyDoc, style: "muted" }] : []),
    { text: h.title, style: "title" },
    { text: h.subtitle, style: "muted", margin: [0, 0, 0, 10] },
  ];
  for (const t of tables) {
    if (t.heading) content.push({ text: t.heading, style: "heading" });
    content.push({
      table: {
        headerRows: 1,
        widths: t.table.widths,
        body: [
          t.table.headers.map((c) => ({ text: c.text, alignment: c.align ?? "left", bold: true, color: "#FFFFFF", fillColor: color, fontSize: 8 })),
          ...t.table.rows.map((r) =>
            r.cells.map((c, i) => {
              const cell = typeof c === "string" ? { text: c } : c;
              return {
                text: cell.text,
                alignment: cell.align ?? "left",
                bold: r.style === "group" || r.style === "total",
                color: r.style === "muted" ? "#64748B" : "#0F172A",
                fillColor: r.style === "total" ? "#EEF2F7" : undefined,
                margin: i === 0 && r.indent ? [r.indent * 8, 0, 0, 0] : undefined,
              };
            }),
          ),
        ],
      },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === 1 ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => "#E2E8F0",
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 12],
    });
  }
  if (note) content.push({ text: note, style: "muted", margin: [0, 4, 0, 0] });

  const doc = printer.createPdfKitDocument({
    info: { title: `${h.title} — ${h.companyName}` },
    pageSize: "A4",
    pageOrientation: h.landscape ? "landscape" : "portrait",
    pageMargins: [36, 40, 36, 60],
    defaultStyle: { font: "Roboto", fontSize: 8.5, lineHeight: 1.15 },
    styles: {
      company: { fontSize: 13, bold: true, color },
      title: { fontSize: 11, bold: true, margin: [0, 8, 0, 0] },
      heading: { fontSize: 9.5, bold: true, margin: [0, 6, 0, 4], color },
      muted: { fontSize: 8, color: "#64748B" },
    },
    footer: (page: number, pages: number) => ({
      margin: [36, 8, 36, 0],
      stack: [
        { text: DISCLAIMER, fontSize: 6.5, color: "#94A3B8" },
        { columns: [{ text: `${h.tenantName} · emitido em ${new Date().toLocaleDateString("pt-BR")}`, fontSize: 7, color: "#94A3B8" }, { text: `página ${page} de ${pages}`, alignment: "right", fontSize: 7, color: "#94A3B8" }], margin: [0, 3, 0, 0] },
      ],
    }),
    content,
  } as never);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// ─────────────────────────── Relatório → tabela ───────────────────────────

const R = (cents: number): PdfCell => ({ text: cents ? formatCents(cents) : "–", align: "right" });
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mm) - 1]}/${y.slice(2)}`;
};

export function trialBalanceTable(rows: TrialBalanceRow[]): PdfTable {
  return {
    headers: [{ text: "Conta" }, { text: "Saldo anterior", align: "right" }, { text: "Débitos", align: "right" }, { text: "Créditos", align: "right" }, { text: "Saldo atual", align: "right" }],
    widths: ["*", 75, 75, 75, 75],
    rows: rows
      .filter((r) => r.opening || r.debits || r.credits || r.level === 1)
      .map((r) => ({ cells: [`${r.code}  ${r.name}`, R(r.opening), R(r.debits), R(r.credits), R(r.closing)], style: r.isAnalytic ? undefined : "group", indent: r.level - 1 })),
  };
}

export function ledgerTable(l: { opening: number; debits: number; credits: number; closing: number; lines: LedgerLine[] }): PdfTable {
  return {
    headers: [{ text: "Data" }, { text: "Nº" }, { text: "Histórico" }, { text: "Contrapartida" }, { text: "Débito", align: "right" }, { text: "Crédito", align: "right" }, { text: "Saldo", align: "right" }],
    widths: [45, 28, "*", 60, 62, 62, 66],
    rows: [
      { cells: ["", "", "Saldo anterior", "", "", "", R(l.opening)], style: "muted" },
      ...l.lines.map((x) => ({ cells: [dmy(x.date), String(x.number), x.lineMemo ? `${x.memo} — ${x.lineMemo}` : x.memo, x.counterparts, R(x.debit), R(x.credit), R(x.balance)] })),
      { cells: ["", "", "Totais e saldo final", "", R(l.debits), R(l.credits), R(l.closing)], style: "total" as const },
    ],
  };
}

export function incomeStatementTable(d: { months: string[]; rows: DreRow[] }): PdfTable {
  const cols = d.months.map(monthLabel);
  const pct = (s: number | null) => ({ text: s == null ? "" : `${(s * 100).toFixed(1).replace(".", ",")}%`, align: "right" as const });
  return {
    headers: [{ text: "Demonstração do resultado" }, ...cols.map((c) => ({ text: c, align: "right" as const })), { text: "Total", align: "right" }, { text: "AV", align: "right" }],
    widths: ["*", ...cols.map(() => 58 as const), 66, 34],
    rows: d.rows.map((r) => ({
      cells: [r.kind === "account" ? `${r.code}  ${r.label}` : r.label, ...(cols.length ? r.values : r.values.slice(-1)).map(R), pct(r.share)],
      style: r.kind === "total" ? "total" : r.kind === "group" ? "group" : undefined,
      indent: r.kind === "account" ? 2 : 0,
    })),
  };
}

export function balanceTable(rows: BalanceRow[]): PdfTable {
  return {
    headers: [{ text: "Conta" }, { text: "Saldo", align: "right" }],
    widths: ["*", 90],
    rows: rows.map((r) => ({ cells: [r.code ? `${r.code}  ${r.name}` : r.name, R(r.amount)], style: r.level <= 2 ? "group" : r.kind === "result" ? "muted" : undefined, indent: r.level - 1 })),
  };
}
