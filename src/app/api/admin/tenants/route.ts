/**
 * Painel Admin Global (somente SUPER_ADMIN).
 * GET: lista tenants com uso · POST: provisiona novo tenant (white-label) com usuário dono.
 */
import { desc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withAdmin } from "@/db";
import { tenants, users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { tenantAdminSchema } from "@/lib/validators";

export const GET = route(
  async () =>
    withAdmin((tx) =>
      tx
        .select({
          tenant: tenants,
          usersCount: sql<number>`(select count(*)::int from users u where u.tenant_id = tenants.id and u.is_active)`,
          companiesCount: sql<number>`(select count(*)::int from companies c where c.tenant_id = tenants.id)`,
          entriesCount: sql<number>`(select count(*)::int from journal_entries e where e.tenant_id = tenants.id)`,
        })
        .from(tenants)
        .orderBy(desc(tenants.createdAt)),
    ),
  { minRole: "SUPER_ADMIN" },
);

export const POST = route(
  async (req) => {
    const body = await parseBody(req, tenantAdminSchema);
    return withAdmin(async (tx) => {
      const { owner, ...data } = body;
      const exists = await tx.execute(sql`select 1 from tenants where slug = ${data.slug} or (domain is not null and domain = ${data.domain ?? ""})`);
      if (exists.rows.length) throw new ApiError(409, "Slug ou domínio já em uso");

      const [t] = await tx
        .insert(tenants)
        .values({ ...data, domain: data.domain || null, trialEndsAt: new Date(Date.now() + 14 * 86_400_000) })
        .returning();
      if (owner) {
        await tx.insert(users).values({ tenantId: t.id, name: owner.name, email: owner.email.toLowerCase(), role: "OWNER", passwordHash: await bcrypt.hash(owner.password, 12) });
      }
      return Response.json(t, { status: 201 });
    });
  },
  { minRole: "SUPER_ADMIN" },
);
