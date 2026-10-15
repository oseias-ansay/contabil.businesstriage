/**
 * Testes da importação de extratos contra PostgreSQL real.
 *   npm run test:bank   (banco de TESTE; cria e apaga o tenant "teste-extratos")
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { pool, withAdmin, withPurge, withTenant, type Tx } from "@/db";
import { accounts, bankLines, journalEntries, tenants } from "@/db/schema";
import { createCompany, setPeriodStatus, closingChecklist } from "@/lib/ledger";
import { generalLedger } from "@/lib/reports";
import { guessCsvMapping, parseCsv } from "@/lib/bank/parse";
import { classifyLines, deleteImport, importStatement, patternFromDescription, postBankLine, saveRule, setIgnored, suggestAccounts, unpostBankLine } from "@/lib/bank/service";

const SLUG = "teste-extratos";
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push(name);
    const err = e as Error & { cause?: Error };
    console.log(`  ✖ ${name}\n      ${err.message} ${err.cause?.message ?? ""}`);
  }
}
async function rejects(fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
  } catch (e) {
    const err = e as Error & { cause?: Error };
    assert.match(`${err.message} ${err.cause?.message ?? ""}`, re);
    return;
  }
  assert.fail(`deveria falhar (${re})`);
}
const cleanup = () => withPurge((tx) => tx.delete(tenants).where(eq(tenants.slug, SLUG)));
const acc = (tx: Tx, companyId: string, code: string) =>
  tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code))).then((r) => r[0].id);

const CSV_JAN = `Data;Histórico;Documento;Valor
05/01/2026;PIX RECEBIDO MARIA SILVA 123456;A1;1.500,00
10/01/2026;TARIFA PACOTE SERVICOS;;-89,90
12/01/2026;CEMIG ENERGIA 0001;;-612,35
15/01/2026;ALUGUEL IMOBILIARIA X;;-4.500,00
20/01/2026;PIX RECEBIDO JOAO SOUZA 999;A2;800,00`;
const CSV_JAN_FEV = `${CSV_JAN}
03/02/2026;TARIFA PACOTE SERVICOS;;-89,90
05/02/2026;CEMIG ENERGIA 0002;;-588,10`;

async function main() {
  await cleanup();
  const [t] = await withAdmin((tx) => tx.insert(tenants).values({ name: SLUG, slug: SLUG, status: "ACTIVE", enabledModules: ["ledger", "reports", "bank"] }).returning());
  const ctx = { tenantId: t.id };
  const { co, a } = await withTenant(t.id, async (tx) => {
    const co = await createCompany(tx, ctx, { legalName: "Loja Extrato Ltda", startDate: "2026-01-01" });
    return {
      co,
      a: {
        bancos: await acc(tx, co.id, "1.1.1.02"),
        clientes: await acc(tx, co.id, "1.1.2.01"),
        vendas: await acc(tx, co.id, "3.1.1.03"),
        tarifas: await acc(tx, co.id, "4.4.1.02"),
        energia: await acc(tx, co.id, "4.3.2.02"),
        aluguel: await acc(tx, co.id, "4.3.2.01"),
        disponibilidades: await acc(tx, co.id, "1.1.1"),
        estoque: await acc(tx, co.id, "1.1.3.01"),
      },
    };
  });
  const parse = (csv: string) => parseCsv(csv, guessCsvMapping(csv));
  const lines = (status?: "PENDING" | "POSTED" | "IGNORED") =>
    withTenant(t.id, (tx) => tx.select().from(bankLines).where(and(eq(bankLines.companyId, co.id), status ? eq(bankLines.status, status) : undefined)).orderBy(bankLines.lineDate, bankLines.description));

  console.log("\nImportação");
  await test("importa o extrato e sugere nada sem regras nem histórico", async () => {
    const r = await withTenant(t.id, (tx) => importStatement(tx, ctx, { companyId: co.id, bankAccountId: a.bancos, fileName: "jan.csv", parsed: parse(CSV_JAN) }));
    assert.equal(r.total, 5);
    assert.equal(r.new, 5);
    assert.equal(r.suggested, 0);
  });
  await test("reimportar extrato sobreposto traz só os movimentos novos", async () => {
    const r = await withTenant(t.id, (tx) => importStatement(tx, ctx, { companyId: co.id, bankAccountId: a.bancos, fileName: "jan-fev.csv", parsed: parse(CSV_JAN_FEV) }));
    assert.equal(r.total, 7);
    assert.equal(r.new, 2);
    assert.equal(r.duplicates, 5);
  });
  await test("conta que não é de banco/cartão é recusada", () =>
    rejects(() => withTenant(t.id, (tx) => importStatement(tx, ctx, { companyId: co.id, bankAccountId: a.estoque, fileName: "x.csv", parsed: parse(CSV_JAN) })), /não é de disponibilidades/));
  await test("conta sintética é recusada", () =>
    rejects(() => withTenant(t.id, (tx) => importStatement(tx, ctx, { companyId: co.id, bankAccountId: a.disponibilidades, fileName: "x.csv", parsed: parse(CSV_JAN) })), /sintética/));

  console.log("\nRegras e sugestões");
  await test("regra de saída classifica as tarifas, e só elas", async () => {
    const r = await withTenant(t.id, (tx) => saveRule(tx, ctx, co.id, { pattern: "Tarifa", direction: "OUT", accountId: a.tarifas }));
    assert.equal(r.rule.pattern, "tarifa");
    assert.equal(r.applied, 2);
    const p = await lines("PENDING");
    assert.deepEqual(p.filter((l) => l.accountId === a.tarifas).map((l) => l.description), ["TARIFA PACOTE SERVICOS", "TARIFA PACOTE SERVICOS"]);
  });
  await test("regra de entrada não pega saídas", async () => {
    await withTenant(t.id, (tx) => saveRule(tx, ctx, co.id, { pattern: "cemig", direction: "IN", accountId: a.vendas }));
    assert.ok((await lines("PENDING")).every((l) => !l.description.startsWith("CEMIG") || l.accountId === null));
  });
  await test("regra casa por palavras, mesmo sem as do meio", async () => {
    const csv = `Data;Histórico;Valor\n07/01/2026;TARIFA PACOTE DE SERVICOS EXTRA;-10,00`;
    await withTenant(t.id, (tx) => importStatement(tx, ctx, { companyId: co.id, bankAccountId: a.bancos, fileName: "x.csv", parsed: parse(csv) }));
    await withTenant(t.id, (tx) => saveRule(tx, ctx, co.id, { pattern: patternFromDescription("TARIFA PACOTE DE SERVICOS"), direction: "OUT", accountId: a.tarifas }));
    const l = (await lines("PENDING")).find((x) => x.description.endsWith("EXTRA"))!;
    assert.equal(l.accountId, a.tarifas);
    await withTenant(t.id, (tx) => setIgnored(tx, co.id, [l.id], true));
  });
  await test("texto sugerido para regra ignora números e palavras genéricas", () => {
    assert.equal(patternFromDescription("PIX RECEBIDO MARIA SILVA 123456"), "maria silva");
    assert.equal(patternFromDescription("CEMIG ENERGIA 0001"), "cemig energia");
  });
  await test("classificação manual vale mais que regra e não é sobrescrita", async () => {
    const energia = (await lines("PENDING")).filter((l) => l.description.startsWith("CEMIG")).map((l) => l.id);
    assert.equal(await withTenant(t.id, (tx) => classifyLines(tx, co.id, { lineIds: energia, accountId: a.energia })), 2);
    await withTenant(t.id, (tx) => saveRule(tx, ctx, co.id, { pattern: "energia", direction: "ANY", accountId: a.aluguel }));
    assert.ok((await lines("PENDING")).filter((l) => energia.includes(l.id)).every((l) => l.accountId === a.energia && l.suggestedBy === "USER"));
  });
  await test("classificação manual recusa conta sintética", () =>
    rejects(async () => {
      const [l] = await lines("PENDING");
      await withTenant(t.id, (tx) => classifyLines(tx, co.id, { lineIds: [l.id], accountId: a.disponibilidades }));
    }, /sintética/));

  console.log("\nLançamento");
  await test("entrada vira D banco / C contrapartida e saída o contrário", async () => {
    const p = await lines("PENDING");
    const maria = p.find((l) => l.description.includes("MARIA"))!;
    const tarifa = p.find((l) => l.description.startsWith("TARIFA") && l.lineDate === "2026-01-10")!;
    await withTenant(t.id, (tx) => classifyLines(tx, co.id, { lineIds: [maria.id], accountId: a.vendas }));
    const e1 = await withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, maria.id));
    const e2 = await withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, tarifa.id));
    const sides = (id: string) =>
      withTenant(t.id, (tx) => tx.execute<{ code: string; debit: string; credit: string }>(sql`select a.code, l.debit, l.credit from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = ${id} order by l.line_no`)).then((r) => r.rows.map((x) => [x.code, x.debit, x.credit]));
    assert.deepEqual(await sides(e1.id), [["1.1.1.02", "1500.00", "0.00"], ["3.1.1.03", "0.00", "1500.00"]]);
    assert.deepEqual(await sides(e2.id), [["4.4.1.02", "89.90", "0.00"], ["1.1.1.02", "0.00", "89.90"]]);
    assert.equal(e1.source, "BANK_IMPORT");
    assert.equal(e1.entryDate, "2026-01-05");
  });
  await test("o mesmo movimento não é lançado duas vezes", async () => {
    const [posted] = await lines("POSTED");
    await rejects(() => withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, posted.id)), /já lançado/);
  });
  await test("movimento sem conta não é lançado", async () => {
    const semConta = (await lines("PENDING")).find((l) => !l.accountId)!;
    await rejects(() => withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, semConta.id)), /Escolha a conta/);
  });
  await test("ignorar e reativar", async () => {
    const aluguel = (await lines("PENDING")).find((l) => l.description.startsWith("ALUGUEL"))!;
    assert.equal(await withTenant(t.id, (tx) => setIgnored(tx, co.id, [aluguel.id], true)), 1);
    await rejects(() => withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, aluguel.id)), /ignorado/);
    assert.equal(await withTenant(t.id, (tx) => setIgnored(tx, co.id, [aluguel.id], false)), 1);
  });
  await test("desfazer estorna, devolve aos pendentes e permite lançar de novo", async () => {
    const maria = (await lines("POSTED")).find((l) => l.description.includes("MARIA"))!;
    await withTenant(t.id, (tx) => unpostBankLine(tx, ctx, co.id, maria.id));
    const back = (await lines("PENDING")).find((l) => l.id === maria.id)!;
    assert.equal(back.entryId, null);
    assert.equal(back.accountId, a.vendas);
    const e = await withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, maria.id));
    assert.equal(e.externalId, `${maria.id}#2`);
    const r = await withTenant(t.id, (tx) => generalLedger(tx, co.id, a.bancos, "2026-01-01", "2026-01-31"));
    assert.equal(r.closing, 150000 - 8990); // lançado, estornado e lançado de novo = uma vez
  });
  await test("histórico aprende: mesmo pagador com outro número sugere a mesma conta", async () => {
    const csv = `Data;Histórico;Valor\n02/02/2026;PIX RECEBIDO MARIA SILVA 777;300,00`;
    const r = await withTenant(t.id, (tx) => importStatement(tx, ctx, { companyId: co.id, bankAccountId: a.bancos, fileName: "fev.csv", parsed: parse(csv) }));
    assert.equal(r.suggested, 1);
    const l = (await lines("PENDING")).find((x) => x.description.endsWith("777"))!;
    assert.equal(l.accountId, a.vendas);
    assert.equal(l.suggestedBy, "HISTORY");
  });

  console.log("\nTravas do banco");
  await test("data e valor do extrato não podem ser alterados", () =>
    rejects(async () => {
      const [l] = await lines("PENDING");
      await withTenant(t.id, (tx) => tx.update(bankLines).set({ amount: "1.00" }).where(eq(bankLines.id, l.id)));
    }, /não podem ser alterados/));
  await test("movimento lançado não pode ser apagado", () =>
    rejects(async () => {
      const [l] = await lines("POSTED");
      await withTenant(t.id, (tx) => tx.delete(bankLines).where(eq(bankLines.id, l.id)));
    }, /não pode ser excluído/));
  await test("lançar em mês fechado é recusado e o movimento fica pendente", async () => {
    const cemigFev = (await lines("PENDING")).find((l) => l.description === "CEMIG ENERGIA 0002")!;
    await withTenant(t.id, (tx) => setPeriodStatus(tx, ctx, { companyId: co.id, competence: "2026-02-01", status: "CLOSED" }));
    await rejects(() => withTenant(t.id, (tx) => postBankLine(tx, ctx, co.id, cemigFev.id)), /fechado/);
    assert.equal((await lines("PENDING")).some((l) => l.id === cemigFev.id), true);
    await withTenant(t.id, (tx) => setPeriodStatus(tx, ctx, { companyId: co.id, competence: "2026-02-01", status: "OPEN" }));
  });
  await test("importação com movimento lançado não pode ser excluída", async () => {
    const [l] = await lines("POSTED");
    await rejects(() => withTenant(t.id, (tx) => deleteImport(tx, ctx, co.id, l.importId)), /já lançados/);
  });

  console.log("\nFechamento");
  await test("checklist avisa extratos pendentes no mês", async () => {
    const items = await withTenant(t.id, (tx) => closingChecklist(tx, co.id, "2026-01-01"));
    const bank = items.find((i) => i.key === "bank")!;
    assert.equal(bank.ok, false);
    assert.equal(bank.blocking, false);
    assert.match(bank.detail!, /movimento/);
  });

  console.log("\nIsolamento");
  await test("outro tenant não vê movimentos nem consegue lançá-los", async () => {
    const [other] = await withAdmin((tx) => tx.insert(tenants).values({ name: SLUG + "-b", slug: SLUG + "-b", enabledModules: ["ledger", "reports", "bank"] }).returning());
    try {
      const seen = await withTenant(other.id, (tx) => tx.select().from(bankLines));
      assert.equal(seen.length, 0);
      const [l] = await lines("PENDING");
      await rejects(() => withTenant(other.id, (tx) => postBankLine(tx, { tenantId: other.id }, co.id, l.id)), /não encontrado/);
      assert.equal(await withTenant(other.id, (tx) => suggestAccounts(tx, co.id)), 0);
    } finally {
      await withPurge((tx) => tx.delete(tenants).where(eq(tenants.id, other.id)));
    }
    // lançados pelo extrato: Maria, tarifa e Maria de novo (o estorno tem origem REVERSAL)
    const [{ c }] = await withTenant(t.id, (tx) => tx.select({ c: sql<number>`count(*)::int` }).from(journalEntries).where(eq(journalEntries.source, "BANK_IMPORT")));
    assert.equal(c, 3);
  });

  await cleanup();
  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  await pool.end();
  if (failures.length) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await pool.end();
  process.exit(1);
});
