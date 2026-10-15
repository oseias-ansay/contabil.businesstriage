/**
 * Bootstrap de PRODUÇÃO (sem dados de exemplo):
 * cria o tenant padrão Business Triage e o usuário Super Admin.
 *
 *   ADMIN_NAME="Oseias" ADMIN_EMAIL="voce@dominio" ADMIN_PASSWORD="..." npm run db:bootstrap
 *
 * Idempotente: se o tenant já existir, não faz nada.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { pool, withAdmin } from "./index";
import * as s from "./schema";
import { MODULES } from "@/lib/plans";

async function main() {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? "business-triage";
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 10) {
    throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 10 caracteres)");
  }

  const created = await withAdmin(async (tx) => {
    const [exists] = await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.slug, slug)).limit(1);
    if (exists) return false;
    const [tenant] = await tx
      .insert(s.tenants)
      .values({
        name: "Business Triage",
        slug,
        status: "ACTIVE",
        plan: "ENTERPRISE",
        maxUsers: 100,
        maxCompanies: 500,
        enabledModules: MODULES.map((m) => m.key),
        primaryColor: "#0F2A44",
        secondaryColor: "#14B8A6",
        loginHeadline: "Diagnóstico preciso. Decisão certa.",
      })
      .returning();
    await tx.insert(s.users).values({
      tenantId: tenant.id,
      name: process.env.ADMIN_NAME ?? "Administrador",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
    });
    return true;
  });

  console.log(created ? `✔ Tenant "${slug}" e Super Admin ${email} criados` : `• Tenant "${slug}" já existe — nada a fazer`);
  await pool.end();
}

main().catch((e) => {
  console.error("✖", e.message ?? e);
  process.exit(1);
});
