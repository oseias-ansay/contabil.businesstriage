/** GET/PATCH da marca do tenant atual (Painel White-Label). */
import { eq } from "drizzle-orm";
import { withAdmin, withTenant } from "@/db";
import { tenants } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { brandingSchema } from "@/lib/validators";
import { invalidateTenantCache } from "@/lib/tenant";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId));
    return {
      id: t.id, name: t.name, slug: t.slug, domain: t.domain, logoUrl: t.logoUrl, faviconUrl: t.faviconUrl,
      primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, loginHeadline: t.loginHeadline,
      plan: t.plan, maxUsers: t.maxUsers, maxCompanies: t.maxCompanies, enabledModules: t.enabledModules,
      rootDomain: process.env.ROOT_DOMAIN,
    };
  }),
);

export const PATCH = route(async (req, { auth }) => {
  const body = await parseBody(req, brandingSchema);
  const domain = body.domain ? body.domain.toLowerCase() : null;
  const updated = await withAdmin(async (tx) => {
    if (domain) {
      const [taken] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.domain, domain));
      if (taken && taken.id !== auth.tenantId) throw new ApiError(409, "Domínio já usado por outra conta");
    }
    const [t] = await tx.update(tenants).set({ ...body, domain }).where(eq(tenants.id, auth.tenantId)).returning();
    return t;
  });
  invalidateTenantCache();
  return updated;
}, { minRole: "OWNER" });
