/** Aplica as migrations do Drizzle, depois o RLS e as regras contábeis (idempotente). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "./index";

async function main() {
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  for (const file of ["rls.sql", "rules.sql"]) {
    await db.execute(sql.raw(readFileSync(path.resolve("drizzle", file), "utf8")));
  }
  console.log("✔ Migrations + RLS + regras contábeis aplicadas");
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
