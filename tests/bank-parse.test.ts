/**
 * Testes dos leitores de extrato (não precisam de banco).
 *   npm run test:parse
 */
import assert from "node:assert/strict";
import { decodeText, detectFormat, guessCsvMapping, parseAmount, parseCsv, parseDate, parseOfx } from "@/lib/bank/parse";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✖ ${name}\n      ${(e as Error).message}`);
  }
}

console.log("\nValores e datas");
test("valores em formatos brasileiros e estrangeiros", () => {
  const cases: [string, number | null][] = [
    ["1.234,56", 123456], ["-1.234,56", -123456], ["1.234,56-", -123456], ["(1.234,56)", -123456],
    ["R$ 99,90", 9990], ["R$ -12,00", -1200], ["1234.56", 123456], ["1,234.56", 123456], ["-0,01", -1],
    ["+500", 50000], ["1.234.567,89", 123456789], ["abc", null], ["", null],
  ];
  for (const [raw, cents] of cases) assert.equal(parseAmount(raw), cents, raw);
});
test("datas", () => {
  assert.equal(parseDate("15/01/2026"), "2026-01-15");
  assert.equal(parseDate("5/1/26"), "2026-01-05");
  assert.equal(parseDate("2026-01-15"), "2026-01-15");
  assert.equal(parseDate("20260115120000[-3:BRT]"), "2026-01-15");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("Saldo"), null);
});

console.log("\nOFX");
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260105120000[-3:BRT]<TRNAMT>1500.00<FITID>A1<MEMO>PIX RECEBIDO JOÃO
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-89,90<FITID>A2<MEMO>TARIFA PACOTE SERVIÇOS
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-89,90<FITID>A2<MEMO>TARIFA PACOTE SERVIÇOS
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115<TRNAMT>-4500.00<NAME>IMOBILIARIA X<MEMO>ALUGUEL &amp; CONDOMINIO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>10.00<DTASOF>20260131</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

test("OFX 1.x em Windows-1252 com acentos", () => {
  const buf = Buffer.from(OFX_SGML, "latin1");
  const text = decodeText(new Uint8Array(buf));
  assert.equal(detectFormat(text), "OFX");
  const r = parseOfx(text);
  assert.equal(r.lines.length, 4);
  assert.equal(r.bank?.bankId, "0341");
  assert.equal(r.bank?.accountId, "12345-6");
  assert.deepEqual(r.lines[0], { date: "2026-01-05", amount: 150000, description: "PIX RECEBIDO JOÃO", document: "A1", dedupeKey: "ofx:A1:2026-01-05:150000" });
  assert.equal(r.lines[1].amount, -8990);
  assert.equal(r.lines[3].description, "IMOBILIARIA X — ALUGUEL & CONDOMINIO");
});
test("OFX com FITID repetido gera chaves distintas e estáveis", () => {
  const r = parseOfx(OFX_SGML);
  assert.notEqual(r.lines[1].dedupeKey, r.lines[2].dedupeKey);
  assert.deepEqual(parseOfx(OFX_SGML).lines.map((l) => l.dedupeKey), r.lines.map((l) => l.dedupeKey));
});
test("OFX 2.x (XML)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
  <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260203</DTPOSTED><TRNAMT>-10.50</TRNAMT><FITID>X9</FITID><MEMO>Café</MEMO></STMTTRN>
  </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = parseOfx(decodeText(new Uint8Array(Buffer.from(xml, "utf8"))));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].description, "Café");
  assert.equal(r.lines[0].amount, -1050);
});

console.log("\nCSV");
test("CSV com título, cabeçalho, coluna única de valor e linhas de saldo", () => {
  const csv = `Extrato Conta Corrente - Agência 1234
Data;Lançamento;Documento;Valor (R$);Saldo (R$)
02/01/2026;SALDO ANTERIOR;;;10.000,00
05/01/2026;PIX RECEBIDO MARIA;123;1.500,00;11.500,00
10/01/2026;TARIFA BANCARIA;;-89,90;11.410,10
10/01/2026;TARIFA BANCARIA;;-89,90;11.320,20
`;
  const m = guessCsvMapping(csv);
  assert.equal(m.delimiter, ";");
  assert.equal(m.hasHeader, true);
  assert.equal(m.date, 0);
  assert.equal(m.description, 1);
  assert.equal(m.amount, 3);
  assert.equal(m.document, 2);
  const r = parseCsv(csv, m);
  assert.deepEqual(r.lines.map((l) => [l.date, l.amount, l.description]), [
    ["2026-01-05", 150000, "PIX RECEBIDO MARIA"],
    ["2026-01-10", -8990, "TARIFA BANCARIA"],
    ["2026-01-10", -8990, "TARIFA BANCARIA"],
  ]);
  assert.notEqual(r.lines[1].dedupeKey, r.lines[2].dedupeKey, "duas tarifas iguais no mesmo dia são legítimas");
});
test("CSV com débito e crédito em colunas separadas e aspas", () => {
  const csv = `"Data","Descrição","Débito","Crédito"
"03/02/2026","Compra, cartão final 1234","250,00",""
"04/02/2026","Depósito","","1.000,00"`;
  const m = guessCsvMapping(csv);
  assert.equal(m.delimiter, ",");
  assert.equal(m.debit, 2);
  assert.equal(m.credit, 3);
  const r = parseCsv(csv, m);
  assert.deepEqual(r.lines.map((l) => [l.description, l.amount]), [["Compra, cartão final 1234", -25000], ["Depósito", 100000]]);
});
test("CSV com coluna D/C dando o sinal", () => {
  const csv = `Data;Historico;Valor;Tipo
01/03/2026;Fornecedor ABC;300,00;D
02/03/2026;Venda;450,00;C`;
  const m = guessCsvMapping(csv);
  assert.equal(m.type, 3);
  assert.deepEqual(parseCsv(csv, m).lines.map((l) => l.amount), [-30000, 45000]);
});
test("CSV sem cabeçalho: deduz colunas pelo conteúdo", () => {
  const csv = `15/03/2026;Energia elétrica;-612,35
16/03/2026;Recebimento cliente;2.000,00
17/03/2026;Internet;-129,90`;
  const m = guessCsvMapping(csv);
  assert.equal(m.hasHeader, false);
  assert.equal(m.date, 0);
  assert.equal(m.description, 1);
  assert.equal(m.amount, 2);
  assert.deepEqual(parseCsv(csv, m).lines.map((l) => l.amount), [-61235, 200000, -12990]);
});
test("mapeamento manual inválido dá erro claro", () => {
  assert.throws(() => parseCsv("a;b", { delimiter: ";", hasHeader: false, date: 0, description: 1 }), /coluna de valor/);
});

console.log(`\n${passed} passaram, ${failures.length} falharam`);
if (failures.length) process.exit(1);
