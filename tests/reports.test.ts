/**
 * Testes dos relatórios (razão, DRE, balanço) com números conferidos à mão.
 *   npm run test:reports   (banco de TESTE; cria e apaga o tenant "teste-relatorios")
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { pool, withAdmin, withPurge, withTenant, type Tx } from "@/db";
import { accounts, tenants } from "@/db/schema";
import { createCompany, postEntry, reverseEntry } from "@/lib/ledger";
import { balanceSheet, fiscalYearStart, generalLedger, incomeStatement, monthEnd, monthsBetween } from "@/lib/reports";

const SLUG = "teste-relatorios";
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✖ ${name}\n      ${(e as Error).message}`);
  }
}
const cleanup = () => withPurge((tx) => tx.delete(tenants).where(eq(tenants.slug, SLUG)));
const acc = (tx: Tx, companyId: string, code: string) =>
  tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code))).then((r) => r[0].id);

async function main() {
  console.log("\nDatas");
  await test("fim de mês, meses do intervalo e início do exercício", () => {
    assert.equal(monthEnd("2026-02-10"), "2026-02-28");
    assert.equal(monthEnd("2028-02-01"), "2028-02-29");
    assert.deepEqual(monthsBetween("2025-11-01", "2026-02-28"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
    assert.equal(fiscalYearStart("2026-03-15", 1), "2026-01-01");
    assert.equal(fiscalYearStart("2026-03-15", 7), "2025-07-01");
  });

  await cleanup();
  const [t] = await withAdmin((tx) => tx.insert(tenants).values({ name: SLUG, slug: SLUG, status: "ACTIVE" }).returning());
  const ctx = { tenantId: t.id };

  const { co, a } = await withTenant(t.id, async (tx) => {
    const co = await createCompany(tx, ctx, { legalName: "Loja Teste Ltda", startDate: "2025-12-01" });
    const a = {
      caixa: await acc(tx, co.id, "1.1.1.01"),
      bancos: await acc(tx, co.id, "1.1.1.02"),
      estoque: await acc(tx, co.id, "1.1.3.01"),
      deprec: await acc(tx, co.id, "1.2.3.06"),
      moveis: await acc(tx, co.id, "1.2.3.02"),
      fornecedores: await acc(tx, co.id, "2.1.1.01"),
      emprestimo: await acc(tx, co.id, "2.2.1.01"),
      capital: await acc(tx, co.id, "2.3.1.01"),
      vendas: await acc(tx, co.id, "3.1.1.01"),
      simples: await acc(tx, co.id, "3.2.1.01"),
      juros: await acc(tx, co.id, "3.3.1.01"),
      cmv: await acc(tx, co.id, "4.1.1.01"),
      marketing: await acc(tx, co.id, "4.2.1.02"),
      aluguel: await acc(tx, co.id, "4.3.2.01"),
      despDeprec: await acc(tx, co.id, "4.3.3.09"),
      tarifas: await acc(tx, co.id, "4.4.1.02"),
    };
    const E = (entryDate: string, memo: string, lines: { accountId: string; debit?: number; credit?: number }[]) => postEntry(tx, ctx, { companyId: co.id, entryDate, memo, lines });
    // dezembro/2025 (exercício anterior)
    await E("2025-12-01", "Capital", [{ accountId: a.bancos, debit: 100000 }, { accountId: a.capital, credit: 100000 }]);
    await E("2025-12-10", "Venda dezembro", [{ accountId: a.bancos, debit: 5000 }, { accountId: a.vendas, credit: 5000 }]);
    await E("2025-12-10", "Aluguel dezembro", [{ accountId: a.aluguel, debit: 2000 }, { accountId: a.bancos, credit: 2000 }]);
    // janeiro/2026
    await E("2026-01-05", "Compra de móveis", [{ accountId: a.moveis, debit: 12000 }, { accountId: a.bancos, credit: 12000 }]);
    await E("2026-01-06", "Compra de mercadorias a prazo", [{ accountId: a.estoque, debit: 20000 }, { accountId: a.fornecedores, credit: 20000 }]);
    await E("2026-01-20", "Vendas janeiro", [{ accountId: a.caixa, debit: 10000 }, { accountId: a.bancos, debit: 30000 }, { accountId: a.vendas, credit: 40000 }]);
    await E("2026-01-31", "CMV janeiro", [{ accountId: a.cmv, debit: 15000 }, { accountId: a.estoque, credit: 15000 }]);
    await E("2026-01-31", "Simples janeiro", [{ accountId: a.simples, debit: 2400 }, { accountId: a.bancos, credit: 2400 }]);
    await E("2026-01-31", "Depreciação janeiro", [{ accountId: a.despDeprec, debit: 100 }, { accountId: a.deprec, credit: 100 }]);
    // fevereiro/2026
    await E("2026-02-01", "Empréstimo bancário", [{ accountId: a.bancos, debit: 50000 }, { accountId: a.emprestimo, credit: 50000 }]);
    await E("2026-02-10", "Marketing", [{ accountId: a.marketing, debit: 3000 }, { accountId: a.bancos, credit: 3000 }]);
    await E("2026-02-15", "Rendimento", [{ accountId: a.bancos, debit: 500 }, { accountId: a.juros, credit: 500 }]);
    await E("2026-02-20", "Tarifas", [{ accountId: a.tarifas, debit: 50 }, { accountId: a.bancos, credit: 50 }]);
    const errado = await E("2026-02-25", "Aluguel duplicado", [{ accountId: a.aluguel, debit: 2000 }, { accountId: a.bancos, credit: 2000 }]);
    await reverseEntry(tx, ctx, { entryId: errado.entry.id, entryDate: "2026-02-26" });
    return { co, a };
  });

  console.log("\nDRE");
  await test("DRE do 1º bimestre de 2026 bate linha a linha", async () => {
    const d = await withTenant(t.id, (tx) => incomeStatement(tx, co.id, "2026-01-01", "2026-02-28", { monthly: true }));
    const v = (k: string) => d.rows.find((r) => r.key === k)!.values;
    assert.deepEqual(d.months, ["2026-01", "2026-02"]);
    assert.deepEqual(v("RECEITA_BRUTA"), [4000000, 0, 4000000]);
    assert.deepEqual(v("DEDUCOES"), [-240000, 0, -240000]);
    assert.deepEqual(v("RECEITA_LIQUIDA"), [3760000, 0, 3760000]);
    assert.deepEqual(v("LUCRO_BRUTO"), [2260000, 0, 2260000]);
    assert.deepEqual(v("DESPESAS_ADMINISTRATIVAS"), [-10000, 0, -10000]); // depreciação; aluguel de fev. estornado
    assert.deepEqual(v("RESULTADO_OPERACIONAL"), [2250000, -300000, 1950000]);
    assert.deepEqual(v("RESULTADO_LIQUIDO"), [2250000, -255000, 1995000]);
    assert.equal(d.netIncome, 1995000);
  });
  await test("análise vertical sobre a receita líquida", async () => {
    const d = await withTenant(t.id, (tx) => incomeStatement(tx, co.id, "2026-01-01", "2026-02-28"));
    const liq = d.rows.find((r) => r.key === "RECEITA_LIQUIDA")!;
    assert.equal(liq.share, 1);
    assert.equal(d.rows.find((r) => r.key === "LUCRO_BRUTO")!.share!.toFixed(4), (2260000 / 3760000).toFixed(4));
  });
  await test("contas aparecem abaixo do seu grupo, só as movimentadas", async () => {
    const d = await withTenant(t.id, (tx) => incomeStatement(tx, co.id, "2026-01-01", "2026-02-28"));
    const i = d.rows.findIndex((r) => r.key === "CUSTOS");
    assert.equal(d.rows[i + 1].code, "4.1.1.01");
    assert.ok(!d.rows.some((r) => r.code === "4.1.1.02"));
  });

  console.log("\nBalanço");
  await test("ativo = passivo + PL + resultado (fim de fevereiro)", async () => {
    const b = await withTenant(t.id, (tx) => balanceSheet(tx, co.id, "2026-02-28"));
    assert.equal(b.difference, 0);
    // bancos: 100000+5000−2000−12000+30000−2400+50000−3000+500−50 = 166050 (o aluguel duplicado e o estorno se anulam)
    const get = (rows: { code: string; amount: number }[], code: string) => rows.find((r) => r.code === code)!.amount;
    assert.equal(get(b.assets, "1.1.1.02"), 16605000);
    assert.equal(get(b.assets, "1.2.3.06"), -10000); // depreciação acumulada reduz o ativo
    assert.equal(get(b.liabilities, "2.2.1.01"), 5000000);
    assert.equal(b.resultPrior, 300000); // dezembro/2025: 5000 − 2000
    assert.equal(b.resultFy, 1995000);
    assert.equal(b.totalAssets, 100000 * 100 + 300000 + 1995000 + 2000000 + 5000000);
  });
  await test("balanço numa data anterior ignora lançamentos posteriores", async () => {
    const b = await withTenant(t.id, (tx) => balanceSheet(tx, co.id, "2025-12-31"));
    assert.equal(b.difference, 0);
    assert.equal(b.resultFy, 300000);
    assert.equal(b.resultPrior, 0);
  });

  console.log("\nRazão");
  await test("razão de Bancos com saldo anterior, corrido e contrapartidas", async () => {
    const r = await withTenant(t.id, (tx) => generalLedger(tx, co.id, a.bancos, "2026-02-01", "2026-02-28"));
    assert.equal(r.opening, 11860000); // fim de janeiro: 103.000 − 12.000 + 30.000 − 2.400
    assert.equal(r.closing, 16605000);
    assert.equal(r.lines[0].balance, 16860000); // + empréstimo de 50.000
    assert.equal(r.lines[0].counterparts, "2.2.1.01");
    assert.equal(r.debits - r.credits, r.closing - r.opening);
  });
  await test("razão de conta sintética soma as analíticas abaixo", async () => {
    const disp = await withTenant(t.id, (tx) => acc(tx, co.id, "1.1.1"));
    const r = await withTenant(t.id, (tx) => generalLedger(tx, co.id, disp, "2026-01-01", "2026-01-31"));
    assert.equal(r.closing, 11860000 + 1000000); // bancos + caixa
    const venda = r.lines.filter((l) => l.memo === "Vendas janeiro");
    assert.equal(venda.length, 2);
    assert.equal(venda[0].counterparts, "3.1.1.01"); // contas da própria árvore não contam como contrapartida
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
