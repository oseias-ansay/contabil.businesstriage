/**
 * Cliente de banco + helpers de isolamento multi-tenant (mesmo padrão do Triage CRM).
 *
 *  withTenant(tenantId, fn)  → transação onde o Postgres só enxerga linhas
 *                              daquele tenant (RLS).
 *  withAdmin(fn)             → transação com bypass de RLS. Usar SOMENTE em:
 *                              resolução de tenant por domínio, login e
 *                              painel Super Admin.
 *  withPurge(fn)             → bypass de RLS + liberação das travas de
 *                              imutabilidade. Usar SOMENTE para excluir um
 *                              tenant inteiro (Admin Global).
 *
 *  Regra de ouro: nunca use `db` direto em rotas de negócio.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

// Reaproveita o pool entre hot-reloads do Next em dev
const g = globalThis as unknown as { __pgPool?: Pool };
const pool =
  g.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
  });
if (process.env.NODE_ENV !== "production") g.__pgPool = pool;

export const db: DB = drizzle(pool, { schema, casing: "snake_case" });

export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error("withTenant: tenantId obrigatório");
  return db.transaction(async (tx) => {
    // `true` = local à transação; some ao fazer COMMIT/ROLLBACK (seguro com pool)
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export async function withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}

export async function withPurge<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true), set_config('app.purge', 'on', true)`);
    return fn(tx);
  });
}

export { schema, pool };
