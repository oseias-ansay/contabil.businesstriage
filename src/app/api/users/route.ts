/** GET equipe do tenant · POST adiciona usuário (respeita o limite do plano; só o dono) */
import { asc, count, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withTenant } from "@/db";
import { tenants, users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { passwordSchema } from "@/lib/password";

export const GET = route(
  async (_req, { auth }) =>
    withTenant(auth.tenantId, (tx) =>
      tx
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, lastLoginAt: users.lastLoginAt })
        .from(users)
        .orderBy(asc(users.name)),
    ),
  { minRole: "OWNER" },
);

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(["MANAGER", "OPERATOR", "VIEWER"]).default("VIEWER"),
});

export const POST = route(
  async (req, { auth }) => {
    const body = await parseBody(req, schema);
    return withTenant(auth.tenantId, async (tx) => {
      const [t] = await tx.select({ max: tenants.maxUsers }).from(tenants).where(eq(tenants.id, auth.tenantId));
      const [{ n }] = await tx.select({ n: count() }).from(users).where(eq(users.isActive, true));
      if (n >= t.max) throw new ApiError(402, `Seu plano permite até ${t.max} usuários`);
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email.toLowerCase()));
      if (exists) throw new ApiError(409, "Já existe um usuário com este e-mail");
      const [u] = await tx
        .insert(users)
        .values({ tenantId: auth.tenantId, name: body.name, email: body.email.toLowerCase(), role: body.role, passwordHash: await bcrypt.hash(body.password, 12) })
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      return u;
    });
  },
  { minRole: "OWNER" },
);
