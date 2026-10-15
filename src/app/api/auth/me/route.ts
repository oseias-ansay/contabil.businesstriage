import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { users } from "@/db/schema";
import { route } from "@/lib/api";
import { getCurrentTenant } from "@/lib/tenant";

export const GET = route(async (_req, { auth }) => {
  const tenant = await getCurrentTenant();
  const [user] = await withTenant(auth.tenantId, (tx) =>
    tx.select({ id: users.id, name: users.name, email: users.email, role: users.role, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, auth.userId)),
  );
  return { user, tenant: tenant && { id: tenant.id, name: tenant.name, slug: tenant.slug, enabledModules: tenant.enabledModules } };
});
