/**
 * Testes das regras contábeis contra um PostgreSQL real.
 *
 *   DATABASE_URL=... npm run db:migrate && npm run test:db
 *
 * Use um banco de TESTE: o script cria e apaga dois tenants próprios
 * (slugs "teste-regras-a" e "teste-regras-b").
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { pool, withAdmin, withPurge, withTenant, type Tx } from "@/db";
import { accounts, companies, journalEntries, tenants } from "@/db/schema";
import { createCompany, postEntry, reverseEntry, setPeriodStatus, trialBalance } from "@/lib/ledger";
import { flattenChart } from "@/lib/chart-of-accounts";

const SLUGS = ["teste-regras-a", "teste-regras-b"];
let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✖ ${name}\n      ${(e as Error).message}`);
  }
}

/** Espera que a operação falhe com mensagem que contenha `match`. */
async function rejects(fn: () => Promise<unknown>, match: RegExp) {
  try {
    await fn();
  } catch (e) {
    const err = e as Error & { cause?: Error };
    const msg = `${err.message} ${err.cause?.message ?? ""}`;
    assert.match(msg, match, `falhou, mas com outra mensagem: ${msg}`);
    return;
  }
  assert.fail(`deveria ter falhado (${match})`);
}

async function cleanup() {
  await withPurge((tx) => tx.delete(tenants).where(inArray(tenants.slug, SLUGS)));
}

const acc = (tx: Tx, companyId: string, code: string) =>
  tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)))
    .then((r) => r[0].id);

async function main() {
  await cleanup();
  const [tA, tB] = await withAdmin((tx) =>
    tx.insert(tenants).values(SLUGS.map((slug) => ({ name: slug, slug, status: "ACTIVE" as const }))).returning(),
  );
  const ctxA = { tenantId: tA.id };
  const ctxB = { tenantId: tB.id };

  const coA = await withTenant(tA.id, (tx) => createCompany(tx, ctxA, { legalName: "Empresa A Ltda", cnpj: "12.345.678/0001-90", startDate: "2026-01-01" }));
  const coB = await withTenant(tB.id, (tx) => createCompany(tx, ctxB, { legalName: "Empresa B Ltda", startDate: "2026-01-01" }));

  const ids = await withTenant(tA.id, async (tx) => ({
    caixa: await acc(tx, coA.id, "1.1.1.01"),
    bancos: await acc(tx, coA.id, "1.1.1.02"),
    disponibilidades: await acc(tx, coA.id, "1.1.1"),
    capital: await acc(tx, coA.id, "2.3.1.01"),
    servicos: await acc(tx, coA.id, "3.1.1.03"),
    aluguel: await acc(tx, coA.id, "4.3.2.01"),
  }));

  console.log("\nPlano de contas");
  await test("empresa nasce com o plano de contas padrão completo", async () => {
    const n = await withTenant(tA.id, (tx) => tx.$count(accounts, eq(accounts.companyId, coA.id)));
    assert.equal(n, flattenChart().length);
    assert.equal(coA.cnpj, "12345678000190");
  });
  await test("toda conta analítica tem grupo de balanço ou de DRE", async () => {
    const rows = await withTenant(tA.id, (tx) => tx.select().from(accounts).where(and(eq(accounts.companyId, coA.id), eq(accounts.isAnalytic, true))));
    for (const a of rows) assert.ok(a.balanceGroup || a.dreGroup, `${a.code} sem grupo`);
  });

  console.log("\nPartidas dobradas");
  await test("lançamento balanceado grava com número sequencial", async () => {
    const r1 = await withTenant(tA.id, (tx) =>
      postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-02", memo: "Integralização de capital", lines: [{ accountId: ids.bancos, debit: "10000" }, { accountId: ids.capital, credit: "10000" }] }),
    );
    const r2 = await withTenant(tA.id, (tx) =>
      postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-05", memo: "Serviço prestado à vista", lines: [{ accountId: ids.caixa, debit: "2.500,00" }, { accountId: ids.servicos, credit: 2500 }] }),
    );
    assert.equal(r1.entry.number, 1);
    assert.equal(r2.entry.number, 2);
    assert.equal(r2.entry.competence, "2026-01-01");
  });
  await test("aplicação recusa lançamento desbalanceado", () =>
    rejects(
      () => withTenant(tA.id, (tx) => postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-06", memo: "Errado", lines: [{ accountId: ids.caixa, debit: 100 }, { accountId: ids.servicos, credit: 90 }] })),
      /desbalanceado/,
    ));
  await test("BANCO recusa lançamento desbalanceado feito por SQL direto", () =>
    rejects(
      () =>
        withTenant(tA.id, async (tx) => {
          const [e] = await tx.insert(journalEntries).values({ tenantId: tA.id, companyId: coA.id, entryDate: "2026-01-06", memo: "SQL direto" }).returning();
          await tx.execute(sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit) values (${tA.id}, ${e.id}, 1, ${ids.caixa}, 100)`);
          await tx.execute(sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, credit) values (${tA.id}, ${e.id}, 2, ${ids.servicos}, 90)`);
        }),
      /desbalanceado/,
    ));
  await test("BANCO recusa lançamento com uma partida só", () =>
    rejects(
      () =>
        withTenant(tA.id, async (tx) => {
          const [e] = await tx.insert(journalEntries).values({ tenantId: tA.id, companyId: coA.id, entryDate: "2026-01-06", memo: "Uma partida" }).returning();
          await tx.execute(sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit) values (${tA.id}, ${e.id}, 1, ${ids.caixa}, 0.01)`);
        }),
      /pelo menos duas partidas/,
    ));
  await test("BANCO recusa partida com débito e crédito na mesma linha", () =>
    rejects(
      () =>
        withTenant(tA.id, async (tx) => {
          const [e] = await tx.insert(journalEntries).values({ tenantId: tA.id, companyId: coA.id, entryDate: "2026-01-06", memo: "Dois lados" }).returning();
          await tx.execute(sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit, credit) values (${tA.id}, ${e.id}, 1, ${ids.caixa}, 10, 10)`);
        }),
      /journal_lines_side_ck/,
    ));
  await test("BANCO recusa lançamento em conta sintética", () =>
    rejects(
      () => withTenant(tA.id, (tx) => postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-06", memo: "Sintética", lines: [{ accountId: ids.disponibilidades, debit: 10 }, { accountId: ids.servicos, credit: 10 }] })),
      /sintética/,
    ));

  console.log("\nImutabilidade e estorno");
  await test("BANCO recusa alterar um lançamento gravado", () =>
    rejects(() => withTenant(tA.id, (tx) => tx.execute(sql`update journal_entries set memo = 'alterado' where company_id = ${coA.id}`)), /não podem ser alterados/));
  await test("BANCO recusa apagar partidas gravadas", () =>
    rejects(() => withTenant(tA.id, (tx) => tx.execute(sql`delete from journal_lines where account_id = ${ids.caixa}`)), /não podem ser alterados/));
  await test("BANCO recusa acrescentar partidas a lançamento de outra transação", () =>
    rejects(
      () =>
        withTenant(tA.id, async (tx) => {
          const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.companyId, coA.id), eq(journalEntries.number, 2)));
          await tx.execute(sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit) values (${tA.id}, ${e.id}, 9, ${ids.caixa}, 50)`);
          await tx.execute(sql`insert into journal_lines (tenant_id, entry_id, line_no, account_id, credit) values (${tA.id}, ${e.id}, 10, ${ids.servicos}, 50)`);
        }),
      /já gravado/,
    ));
  await test("estorno inverte as partidas e zera o efeito", async () => {
    const tb = await withTenant(tA.id, async (tx) => {
      const r = await postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-10", memo: "Aluguel lançado errado", lines: [{ accountId: ids.aluguel, debit: 3000 }, { accountId: ids.caixa, credit: 3000 }] });
      const rev = await reverseEntry(tx, ctxA, { entryId: r.entry.id, entryDate: "2026-01-10" });
      assert.equal(rev.source, "REVERSAL");
      return trialBalance(tx, coA.id, "2026-01-01", "2026-01-31");
    });
    const aluguel = tb.find((r) => r.code === "4.3.2.01")!;
    assert.equal(aluguel.debits, 300000);
    assert.equal(aluguel.credits, 300000);
    assert.equal(aluguel.closing, 0);
  });
  await test("o mesmo lançamento não pode ser estornado duas vezes", () =>
    rejects(
      () =>
        withTenant(tA.id, async (tx) => {
          const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.companyId, coA.id), eq(journalEntries.memo, "Aluguel lançado errado")));
          await reverseEntry(tx, ctxA, { entryId: e.id, entryDate: "2026-01-11" });
        }),
      /já foi estornado/,
    ));

  console.log("\nPeríodos");
  await test("BANCO recusa lançamento em mês fechado", async () => {
    await withTenant(tA.id, (tx) => setPeriodStatus(tx, ctxA, { companyId: coA.id, competence: "2026-01-15", status: "CLOSED" }));
    await rejects(
      () => withTenant(tA.id, (tx) => postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-20", memo: "Mês fechado", lines: [{ accountId: ids.caixa, debit: 1 }, { accountId: ids.servicos, credit: 1 }] })),
      /período 01\/2026 está fechado/,
    );
  });
  await test("mês reaberto volta a aceitar lançamentos", async () => {
    await withTenant(tA.id, (tx) => setPeriodStatus(tx, ctxA, { companyId: coA.id, competence: "2026-01-01", status: "OPEN" }));
    const r = await withTenant(tA.id, (tx) => postEntry(tx, ctxA, { companyId: coA.id, entryDate: "2026-01-20", memo: "Depois de reabrir", lines: [{ accountId: ids.caixa, debit: 1 }, { accountId: ids.servicos, credit: 1 }] }));
    assert.ok(r.entry.number > 0);
  });

  console.log("\nIdempotência");
  await test("o mesmo evento externo não gera dois lançamentos", async () => {
    const input = { companyId: coA.id, entryDate: "2026-02-03", memo: "Recebimento via Plataforma", source: "PLATFORM" as const, externalId: "plat-evt-001", lines: [{ accountId: ids.bancos, debit: 500 }, { accountId: ids.servicos, credit: 500 }] };
    const a = await withTenant(tA.id, (tx) => postEntry(tx, ctxA, input));
    const b = await withTenant(tA.id, (tx) => postEntry(tx, ctxA, input));
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(a.entry.id, b.entry.id);
  });

  console.log("\nIsolamento entre tenants (RLS)");
  await test("tenant B não enxerga empresas do tenant A", async () => {
    const rows = await withTenant(tB.id, (tx) => tx.select().from(companies));
    assert.deepEqual(rows.map((r) => r.id), [coB.id]);
  });
  await test("tenant B não consegue lançar nas contas do tenant A", () =>
    rejects(
      () => withTenant(tB.id, (tx) => postEntry(tx, ctxB, { companyId: coA.id, entryDate: "2026-02-01", memo: "Invasão", lines: [{ accountId: ids.caixa, debit: 1 }, { accountId: ids.servicos, credit: 1 }] })),
      /Empresa inválida|row-level security/,
    ));

  console.log("\nProteção do plano de contas");
  await test("BANCO recusa mudar a natureza de conta movimentada", () =>
    rejects(() => withTenant(tA.id, (tx) => tx.update(accounts).set({ nature: "CREDIT" }).where(eq(accounts.id, ids.caixa))), /já foi movimentada/));
  await test("BANCO recusa excluir conta movimentada", () =>
    rejects(() => withTenant(tA.id, (tx) => tx.delete(accounts).where(eq(accounts.id, ids.caixa))), /não pode ser excluída/));
  await test("empresa sem lançamentos pode ser excluída; com lançamentos, não", async () => {
    await withTenant(tB.id, (tx) => tx.delete(companies).where(eq(companies.id, coB.id)));
    await rejects(() => withTenant(tA.id, (tx) => tx.delete(companies).where(eq(companies.id, coA.id))), /não pode ser excluída/);
  });

  console.log("\nBalancete");
  await test("balancete fecha: débitos = créditos e saldos batem", async () => {
    const tb = await withTenant(tA.id, (tx) => trialBalance(tx, coA.id, "2026-01-01", "2026-02-28"));
    const top = tb.filter((r) => r.level === 1);
    const d = top.reduce((s, r) => s + r.debits, 0);
    const c = top.reduce((s, r) => s + r.credits, 0);
    assert.equal(d, c);
    const get = (code: string) => tb.find((r) => r.code === code)!.closing;
    assert.equal(get("1.1.1.01"), 250100); // caixa: 2.500 + 1 (−3.000 e +3.000 do estorno se anulam)
    assert.equal(get("1.1.1.02"), 1050000); // bancos: 10.000 + 500
    assert.equal(get("1.1.1"), 1300100); // sintética soma as filhas
    assert.equal(get("2.3.1.01"), 1000000); // capital, saldo credor positivo
    assert.equal(get("3.1.1.03"), 300100); // receita de serviços: 2.500 + 1 + 500
  });
  await test("saldo anterior considera lançamentos antes do início do período", async () => {
    const tb = await withTenant(tA.id, (tx) => trialBalance(tx, coA.id, "2026-02-01", "2026-02-28"));
    const bancos = tb.find((r) => r.code === "1.1.1.02")!;
    assert.equal(bancos.opening, 1000000);
    assert.equal(bancos.debits, 50000);
    assert.equal(bancos.closing, 1050000);
  });

  console.log("\nExclusão de tenant (Admin Global)");
  await test("withPurge apaga um tenant inteiro, inclusive o livro-razão", async () => {
    await cleanup();
    const left = await withAdmin((tx) => tx.select().from(tenants).where(inArray(tenants.slug, SLUGS)));
    assert.equal(left.length, 0);
  });

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
