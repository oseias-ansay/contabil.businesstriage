/**
 * Seed de DESENVOLVIMENTO:
 *  - tenant "business-triage" + Super Admin (admin@businesstriage.com.br / Triage@2026)
 *  - empresa de exemplo com plano de contas padrão e alguns lançamentos de janeiro
 *  - tenant "demo-cliente" (STARTER) para provar o isolamento entre contas
 *
 * Rodar: npm run db:seed   (apaga e recria os 2 tenants)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { pool, withAdmin, withPurge, withTenant, type Tx } from "./index";
import * as s from "./schema";
import { createCompany, postEntry } from "@/lib/ledger";
import { MODULES } from "@/lib/plans";

const SLUGS = ["business-triage", "demo-cliente"];

async function account(tx: Tx, companyId: string, code: string) {
  const [a] = await tx.select({ id: s.accounts.id }).from(s.accounts).where(and(eq(s.accounts.companyId, companyId), eq(s.accounts.code, code)));
  return a.id;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed de desenvolvimento não roda em produção (use db:bootstrap)");
  await withPurge((tx) => tx.delete(s.tenants).where(inArray(s.tenants.slug, SLUGS)));
  const hash = await bcrypt.hash("Triage@2026", 12);

  const [bt] = await withAdmin(async (tx) => {
    const ts = await tx
      .insert(s.tenants)
      .values([
        { name: "Business Triage", slug: SLUGS[0], status: "ACTIVE", plan: "ENTERPRISE", maxUsers: 100, maxCompanies: 500, enabledModules: MODULES.map((m) => m.key), loginHeadline: "Diagnóstico preciso. Decisão certa." },
        { name: "Demo Cliente", slug: SLUGS[1], status: "TRIAL", plan: "STARTER", maxUsers: 3, maxCompanies: 1, primaryColor: "#4C1D95", secondaryColor: "#F59E0B" },
      ])
      .returning();
    await tx.insert(s.users).values([
      { tenantId: ts[0].id, name: "Oseias", email: "admin@businesstriage.com.br", passwordHash: hash, role: "SUPER_ADMIN" },
      { tenantId: ts[0].id, name: "Operadora BT", email: "operador@businesstriage.com.br", passwordHash: hash, role: "OPERATOR" },
      { tenantId: ts[1].id, name: "Dono Demo", email: "dono@demo.com.br", passwordHash: hash, role: "OWNER" },
    ]);
    return ts;
  });

  await withTenant(bt.id, async (tx) => {
    const ctx = { tenantId: bt.id, userName: "Seed" };
    const co = await createCompany(tx, ctx, { legalName: "Padaria Exemplo Ltda", tradeName: "Padaria Exemplo", cnpj: "11222333000181", startDate: "2026-01-01" });
    const a = {
      caixa: await account(tx, co.id, "1.1.1.01"),
      bancos: await account(tx, co.id, "1.1.1.02"),
      estoque: await account(tx, co.id, "1.1.3.01"),
      fornecedores: await account(tx, co.id, "2.1.1.01"),
      capital: await account(tx, co.id, "2.3.1.01"),
      vendas: await account(tx, co.id, "3.1.1.01"),
      simples: await account(tx, co.id, "3.2.1.01"),
      cmv: await account(tx, co.id, "4.1.1.01"),
      aluguel: await account(tx, co.id, "4.3.2.01"),
      tarifas: await account(tx, co.id, "4.4.1.02"),
    };
    const entries: Parameters<typeof postEntry>[2][] = [
      { companyId: co.id, entryDate: "2026-01-02", memo: "Integralização de capital", source: "OPENING", lines: [{ accountId: a.bancos, debit: 50000 }, { accountId: a.capital, credit: 50000 }] },
      { companyId: co.id, entryDate: "2026-01-05", memo: "Compra de mercadorias a prazo — NF 1201", lines: [{ accountId: a.estoque, debit: 12000 }, { accountId: a.fornecedores, credit: 12000 }] },
      { companyId: co.id, entryDate: "2026-01-31", memo: "Vendas de janeiro", lines: [{ accountId: a.caixa, debit: 8000 }, { accountId: a.bancos, debit: 22000 }, { accountId: a.vendas, credit: 30000 }] },
      { companyId: co.id, entryDate: "2026-01-31", memo: "Baixa do custo das mercadorias vendidas", lines: [{ accountId: a.cmv, debit: 11000 }, { accountId: a.estoque, credit: 11000 }] },
      { companyId: co.id, entryDate: "2026-01-31", memo: "Simples Nacional sobre vendas de janeiro", lines: [{ accountId: a.simples, debit: 1800 }, { accountId: a.bancos, credit: 1800 }] },
      { companyId: co.id, entryDate: "2026-01-10", memo: "Aluguel da loja — janeiro", lines: [{ accountId: a.aluguel, debit: 4500 }, { accountId: a.bancos, credit: 4500 }] },
      { companyId: co.id, entryDate: "2026-01-31", memo: "Tarifas bancárias", lines: [{ accountId: a.tarifas, debit: "89,90" }, { accountId: a.bancos, credit: "89,90" }] },
    ];
    for (const e of entries) await postEntry(tx, ctx, e);
  });

  console.log("✔ Seed concluído");
  console.log("  Super Admin: admin@businesstriage.com.br / Triage@2026  (http://localhost:3200)");
  console.log("  Demo:        dono@demo.com.br / Triage@2026             (http://localhost:3200/?tenant=demo-cliente)");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
