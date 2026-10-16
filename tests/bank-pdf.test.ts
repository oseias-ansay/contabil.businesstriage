/**
 * Leitura de extratos em PDF (não precisa de banco). Os PDFs são gerados aqui, imitando
 * os layouts mais comuns dos bancos brasileiros.
 *   npm run test:pdf
 */
import assert from "node:assert/strict";
import { groupLines, parsePdf, parsePdfLines } from "@/lib/bank/pdf";
import { BankParseError } from "@/lib/bank/parse";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✖ ${name}\n      ${(e as Error).stack?.split("\n").slice(0, 3).join("\n      ")}`);
  }
}

type Cell = string | { text: string; alignment?: string; colSpan?: number };
async function makePdf(content: unknown[], extra: Record<string, unknown> = {}): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pdfmake");
  const PdfPrinter = mod.default ?? mod;
  const vfs = (await import("pdfmake/build/vfs_fonts.js")) as unknown as Record<string, string> & { default?: Record<string, string> };
  const fonts = vfs.default ?? vfs;
  const b = (f: string) => Buffer.from(fonts[f], "base64");
  const printer = new PdfPrinter({ Roboto: { normal: b("Roboto-Regular.ttf"), bold: b("Roboto-Medium.ttf"), italics: b("Roboto-Italic.ttf"), bolditalics: b("Roboto-MediumItalic.ttf") } });
  const doc = printer.createPdfKitDocument({ content, defaultStyle: { fontSize: 8 }, pageSize: "A4", ...extra });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
    doc.end();
  });
}
const table = (widths: (number | string)[], rows: Cell[][]) => ({ table: { headerRows: 1, widths, body: rows }, layout: "noBorders" });
const right = (text: string) => ({ text, alignment: "right" });
const sum = (xs: { amount: number }[]) => xs.reduce((s, l) => s + l.amount, 0);

async function main() {
  console.log("\nLayout 1: Data | Lançamento | Valor com sinal | Saldo, datas sem ano");
  const pdf1 = await makePdf([
    { text: "Banco Exemplo S.A. · Extrato de conta corrente", bold: true, fontSize: 11 },
    "Agência 1234 · Conta 56789-0 · Período: 01/03/2026 a 31/03/2026",
    { text: " " },
    table([40, "*", 60, 70, 70], [
      ["Data", "Lançamento", "Ag./Origem", right("Valor (R$)"), right("Saldo (R$)")],
      ["01/03", "SALDO ANTERIOR", "", "", right("1.000,00")],
      ["02/03", "PIX RECEBIDO JOAO DA SILVA", "0001", right("500,00"), ""],
      ["02/03", "TAR PACOTE SERVICOS", "", right("-45,90"), right("1.454,10")],
      ["05/03", "PAG BOLETO COPEL DISTRIBUICAO", "", right("-312,40"), right("1.141,70")],
      ["", "SALDO DO DIA", "", "", right("1.141,70")],
      ["10/03", "TED RECEBIDA ACME LTDA", "237", right("2.350,00"), right("3.491,70")],
      ["10/03", "PIX RECEBIDO JOAO DA SILVA", "0001", right("500,00"), right("3.991,70")],
    ]),
    { text: " " },
    "Total de créditos 3.350,00 · Total de débitos 358,30 · Emitido em 02/04/2026 08:15",
    "Ouvidoria 0800 000 0000",
  ]);
  const r1 = await parsePdf(pdf1);
  await test("lê os 5 movimentos e ignora saldos e totais", () => {
    assert.equal(r1.format, "PDF");
    assert.deepEqual(r1.lines.map((l) => [l.date, l.amount]), [["2026-03-02", 50000], ["2026-03-02", -4590], ["2026-03-05", -31240], ["2026-03-10", 235000], ["2026-03-10", 50000]]);
    assert.equal(r1.warnings.length, 0, r1.warnings.join(" | "));
  });
  await test("histórico sem a coluna de agência e chaves distintas para pix iguais em dias diferentes", () => {
    assert.equal(r1.lines[3].description, "TED RECEBIDA ACME LTDA 237");
    assert.equal(new Set(r1.lines.map((l) => l.dedupeKey)).size, 5);
  });
  await test("ler de novo dá as mesmas chaves (reimportar não duplica)", async () => {
    const again = await parsePdf(pdf1);
    assert.deepEqual(again.lines.map((l) => l.dedupeKey), r1.lines.map((l) => l.dedupeKey));
  });

  console.log("\nLayout 2: Débito | Crédito | Saldo, data só no 1º do dia, histórico em 2 linhas, 2 páginas");
  const rows2: Cell[][] = [["Data", "Histórico", "Documento", right("Débito"), right("Crédito"), right("Saldo")]];
  rows2.push(["31/12/2025", "Saldo Anterior", "", "", "", right("10.000,00 C")]);
  rows2.push(["02/01/2026", "Pix - Recebido", "112233", "", right("1.200,00"), ""]);
  rows2.push(["", "02/01 09:14 MARIA SOUZA", "", "", "", ""]);
  rows2.push(["", "Pagamento de Boleto", "445566", right("850,75"), "", right("10.349,25 C")]);
  rows2.push(["", "ENERGISA SA", "", "", "", ""]);
  for (let i = 0; i < 45; i++) rows2.push([`${String(5 + (i % 20)).padStart(2, "0")}/01/2026`, `Compra com Cartão - LOJA ${i + 1}`, `9${String(i).padStart(4, "0")}`, right("10,00"), "", ""]);
  rows2.push(["30/01/2026", "Tarifa Pacote de Serviços", "", right("39,90"), "", right("9.859,35 C")]);
  const pdf2 = await makePdf([{ text: "Extrato Conta Corrente · Janeiro/2026", bold: true }, table([60, "*", 50, 60, 60, 70], rows2)]);
  const r2 = await parsePdf(pdf2);
  await test("lê os 48 movimentos nas duas páginas, com sinal pelas colunas", () => {
    assert.equal(r2.lines.length, 48, r2.lines.map((l) => `${l.date} ${l.amount} ${l.description}`).join("\n"));
    assert.equal(sum(r2.lines), 120000 - 85075 - 45 * 1000 - 3990);
    assert.ok(r2.lines.filter((l) => l.amount === -1000).length === 45);
  });
  await test("data repetida do dia anterior e histórico de duas linhas", () => {
    const boleto = r2.lines.find((l) => l.amount === -85075)!;
    assert.equal(boleto.date, "2026-01-02");
    assert.equal(boleto.description, "Pagamento de Boleto ENERGISA SA");
    assert.equal(boleto.document, "445566");
    assert.equal(r2.lines[0].description, "Pix - Recebido 02/01 09:14 MARIA SOUZA");
  });

  console.log("\nLayout 3: sem cabeçalho, valores sem sinal (o banco usa só cor)");
  const pdf3 = await makePdf([
    "EXTRATO · 01/04/2026 a 30/04/2026",
    table([60, "*", 70, 70], [
      ["", "", "", ""],
      ["01/04/2026", "SALDO ANTERIOR", "", right("3.000,00")],
      ["03/04/2026", "COMPRA CARTAO MERCADO BOM PRECO", right("89,90"), right("2.910,10")],
      ["08/04/2026", "DEPOSITO EM DINHEIRO", right("1.000,00"), right("3.910,10")],
      ["15/04/2026", "ALUGUEL ABRIL", right("1.500,00"), right("2.410,10")],
      ["20/04/2026", "ESTORNO COMPRA", right("89,90"), right("2.500,00")],
    ]),
  ]);
  const r3 = await parsePdf(pdf3);
  await test("sinal deduzido pela variação do saldo", () => {
    assert.deepEqual(r3.lines.map((l) => l.amount), [-8990, 100000, -150000, 8990]);
    assert.equal(r3.warnings.length, 0, r3.warnings.join(" | "));
  });

  console.log("\nLayout 4: banco digital, agrupado por dia com totais de entradas e saídas");
  const day = (d: string, inT: string | null, ins: [string, string][], outT: string | null, outs: [string, string][]) => [
    { columns: [{ text: d, bold: true, width: 90 }, { text: inT ? "Total de entradas" : "", width: "*" }, { text: inT ?? "", alignment: "right", width: 80 }] },
    ...ins.map(([t, v]) => ({ columns: [{ text: "", width: 90 }, { text: t, width: "*" }, { text: v, alignment: "right", width: 80 }] })),
    ...(outT ? [{ columns: [{ text: "", width: 90 }, { text: "Total de saídas", width: "*" }, { text: outT, alignment: "right", width: 80 }] }] : []),
    ...outs.map(([t, v]) => ({ columns: [{ text: "", width: 90 }, { text: t, width: "*" }, { text: v, alignment: "right", width: 80 }] })),
    { text: " " },
  ];
  const pdf4 = await makePdf([
    "Extrato · 01 de março de 2026 a 31 de março de 2026",
    "Saldo inicial R$ 2.000,00",
    ...day("02 MAR 2026", "+ 1.700,00", [["Transferência recebida pelo Pix FULANO DE TAL", "1.200,00"], ["Transferência recebida pelo Pix CICLANO", "500,00"]], "- 150,00", [["Transferência enviada pelo Pix FORNECEDOR XYZ", "150,00"]]),
    ...day("05 MAR 2026", null, [], "- 89,90", [["Pagamento de boleto efetuado OPERADORA", "89,90"]]),
  ]);
  const r4 = await parsePdf(pdf4);
  await test("datas por extenso e sinal pelo bloco de entradas/saídas", () => {
    assert.deepEqual(r4.lines.map((l) => [l.date, l.amount]), [["2026-03-02", 120000], ["2026-03-02", 50000], ["2026-03-02", -15000], ["2026-03-05", -8990]], JSON.stringify(r4.lines));
    assert.equal(r4.lines[0].description, "Transferência recebida pelo Pix FULANO DE TAL");
    assert.equal(r4.warnings.length, 0, r4.warnings.join(" | "));
  });

  console.log("\nCasos de erro");
  await test("PDF com senha: pede a senha, recusa a errada e abre com a certa", async () => {
    const locked = await makePdf(["EXTRATO 01/05/2026", table([60, "*", 70], [["Data", "Histórico", right("Valor")], ["02/05/2026", "PIX RECEBIDO", right("10,00")], ["03/05/2026", "PIX ENVIADO", right("-5,00")]])], { userPassword: "12345678900" });
    await assert.rejects(parsePdf(locked), (e: Error) => e instanceof BankParseError && /protegido por senha/.test(e.message));
    await assert.rejects(parsePdf(locked, "000"), (e: Error) => e instanceof BankParseError && /incorreta/.test(e.message));
    const ok = await parsePdf(locked, "12345678900");
    assert.deepEqual(ok.lines.map((l) => l.amount), [1000, -500]);
  });
  await test("PDF sem texto (digitalizado) explica o que fazer", async () => {
    const blank = await makePdf([{ canvas: [{ type: "rect", x: 0, y: 0, w: 200, h: 100, color: "#cccccc" }] }]);
    await assert.rejects(parsePdf(blank), (e: Error) => /digitalizado/.test(e.message));
  });
  await test("arquivo que não é PDF", async () => {
    await assert.rejects(parsePdf(new TextEncoder().encode("não sou pdf")), (e: Error) => e instanceof BankParseError);
  });

  console.log("\nGeometria (trechos picados letra a letra, como alguns bancos geram)");
  await test("junta letras em palavras e separa colunas pelo espaço largo", () => {
    const items: { str: string; x: number; y: number; w: number; h: number }[] = [];
    const put = (s: string, x: number, y: number) => [...s].forEach((ch, i) => items.push({ str: ch, x: x + i * 4.5, y, w: 4.5, h: 8 }));
    put("Data", 40, 700); put("Histórico", 100, 700); put("Valor", 400, 700); put("Saldo", 480, 700);
    put("06/02", 40, 688); put("PIX", 100, 688); put("ENVIADO", 118, 688); put("25,00", 400, 688); put("D", 425, 688); put("975,00", 480, 688);
    const lines = groupLines(1, items);
    assert.deepEqual(lines[1].cells.map((c) => c.text), ["06/02", "PIX ENVIADO", "25,00 D", "975,00"]);
    const r = parsePdfLines([...lines, ...groupLines(1, [{ str: "Emitido em 07/02/2026", x: 40, y: 600, w: 90, h: 8 }])]);
    assert.deepEqual(r.lines.map((l) => [l.date, l.amount, l.description]), [["2026-02-06", -2500, "PIX ENVIADO"]]);
  });

  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
