/**
 * Teste de ponta a ponta pela API HTTP (precisa do servidor rodando e do seed de desenvolvimento).
 *
 *   npm run db:seed && npm run dev            # em outro terminal
 *   BASE_URL=http://localhost:3200 npm run test:api
 *
 * Cobre o caminho que a tela usa: valores digitados em formato brasileiro
 * precisam chegar ao banco exatamente como digitados (regressão: R$ 612,35
 * chegou a ser gravado como R$ 61.235,00 por conversão dupla).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
let cookie = "";
let passed = 0;
const failures: string[] = [];

async function call<T = any>(path: string, init: { method?: string; json?: unknown } = {}): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.json ? "POST" : "GET"),
    headers: { ...(init.json ? { "content-type": "application/json" } : {}), ...(cookie && { cookie }) },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set?.startsWith("contabil_session=")) cookie = set.split(";")[0];
  const text = await res.text();
  return { status: res.status, body: (text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as T };
}
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

async function main() {
  const login = await call("/api/auth/login", { json: { email: "admin@businesstriage.com.br", password: "Triage@2026" } });
  assert.equal(login.status, 200, "login do seed falhou: rode npm run db:seed");
  const companies = (await call<{ company: { id: string }; entriesCount: number }[]>("/api/companies")).body;
  const co = companies.find((c) => c.entriesCount > 0)!.company.id;
  const accounts = (await call<{ id: string; code: string }[]>(`/api/companies/${co}/accounts`)).body;
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const stamp = Date.now().toString(36);

  console.log("\nValores digitados");
  for (const [typed, stored] of [["612,35", "612.35"], ["1.234,56", "1234.56"], ["0,01", "0.01"], ["R$ 99,90", "99.90"], [612.35, "612.35"]] as const) {
    await test(`${JSON.stringify(typed)} grava ${stored}`, async () => {
      const memo = `Smoke ${stamp} ${typed}`;
      const r = await call(`/api/companies/${co}/entries`, { json: { entryDate: "2026-02-10", memo, lines: [{ accountId: id("4.3.2.02"), debit: typed }, { accountId: id("1.1.1.02"), credit: typed }] } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const list = await call<{ entries: { memo: string; amount: string }[] }>(`/api/companies/${co}/entries?from=2026-02-01&to=2026-02-28&q=${encodeURIComponent(memo)}`);
      assert.equal(list.body.entries[0]?.amount, stored);
    });
  }
  await test("saldo de abertura grava o valor digitado", async () => {
    const r = await call<{ id: string }>(`/api/companies/${co}/opening`, { json: { entryDate: "2026-01-01", balances: [{ accountId: id("1.1.1.03"), amount: "1.500,25" }] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const e = await call<{ lines: { code: string; debit: string; credit: string }[] }>(`/api/companies/${co}/entries/${r.body.id}`);
    assert.deepEqual(e.body.lines.map((l) => [l.code, l.debit, l.credit]), [["1.1.1.03", "1500.25", "0.00"], ["2.3.9.01", "0.00", "1500.25"]]);
  });

  console.log("\nRegras pela API");
  await test("desbalanceado → 422 com mensagem clara", async () => {
    const r = await call<{ error: string }>(`/api/companies/${co}/entries`, { json: { entryDate: "2026-02-10", memo: "Errado", lines: [{ accountId: id("1.1.1.01"), debit: "100" }, { accountId: id("3.1.1.01"), credit: "90" }] } });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /desbalanceado/);
  });
  await test("mês fechado → 422 e reabrir libera", async () => {
    const close = await call(`/api/companies/${co}/periods`, { json: { competence: "2026-03", status: "CLOSED", acceptWarnings: true } });
    assert.equal(close.status, 200, JSON.stringify(close.body));
    const r = await call<{ error: string }>(`/api/companies/${co}/entries`, { json: { entryDate: "2026-03-05", memo: "Em mês fechado", lines: [{ accountId: id("1.1.1.01"), debit: "1" }, { accountId: id("3.1.1.01"), credit: "1" }] } });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /fechado/);
    assert.equal((await call(`/api/companies/${co}/periods`, { json: { competence: "2026-03", status: "OPEN" } })).status, 200);
  });
  await test("balanço confere depois de tudo", async () => {
    const b = await call<{ difference: number }>(`/api/companies/${co}/reports/balanco?asOf=2026-12-31`);
    assert.equal(b.body.difference, 0);
  });
  await test("relatórios em PDF", async () => {
    for (const q of ["dre?from=2026-01-01&to=2026-03-31&monthly=1", "balanco?asOf=2026-03-31", "balancete?from=2026-01-01&to=2026-03-31"]) {
      const res = await fetch(`${BASE}/api/companies/${co}/reports/${q}&format=pdf`, { headers: { cookie } });
      assert.equal(res.headers.get("content-type"), "application/pdf", q);
      assert.ok((await res.arrayBuffer()).byteLength > 5000, q);
    }
  });

  console.log("\nExtratos");
  await test("importa o OFX de exemplo sem duplicar na segunda vez", async () => {
    const bank = id("1.1.1.02");
    const send = async () => {
      const fd = new FormData();
      fd.append("file", new Blob([readFileSync("docs/exemplos/extrato-exemplo-fev2026.ofx")]), "extrato-exemplo-fev2026.ofx");
      fd.append("bankAccountId", bank);
      const res = await fetch(`${BASE}/api/companies/${co}/bank/imports`, { method: "POST", body: fd, headers: { cookie } });
      return { status: res.status, body: (await res.json()) as { new: number; duplicates: number } };
    };
    const a = await send();
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await send();
    assert.equal(b.body.new, 0);
    assert.equal(b.body.duplicates, a.body.new + a.body.duplicates);
  });
  await test("regra classifica e o lote lança, com resposta por movimento", async () => {
    const r = await call(`/api/companies/${co}/bank/rules`, { json: { pattern: "tarifa servicos", direction: "OUT", accountId: id("4.4.1.02") } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const pend = await call<{ lines: { id: string; accountId: string | null; description: string }[] }>(`/api/companies/${co}/bank/lines?status=PENDING&q=tarifa`);
    const ids = pend.body.lines.map((l) => l.id);
    assert.ok(ids.length >= 2 && pend.body.lines.every((l) => l.accountId === id("4.4.1.02")));
    const semConta = (await call<{ lines: { id: string; accountId: string | null }[] }>(`/api/companies/${co}/bank/lines?status=PENDING&q=copel`)).body.lines[0].id;
    const post = await call<{ posted: unknown[]; failed: { error: string }[] }>(`/api/companies/${co}/bank/lines/post`, { json: { lineIds: [...ids, semConta] } });
    assert.equal(post.body.posted.length, ids.length);
    assert.match(post.body.failed[0].error, /Escolha a conta/);
  });

  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
