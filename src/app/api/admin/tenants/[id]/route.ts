/** PATCH plano, limites, módulos, status e marca de um tenant (SUPER_ADMIN). */
import { eq } from "drizzle-orm";
import { withAdmin } from "@/db";
import { tenants } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { tenantAdminSchema } from "@/lib/validators";
import { invalidateTenantCache } from "@/lib/tenant";

export const PATCH = route<{ id: string }>(
  async (req, { params }) => {
    const { owner: _owner, ...body } = await parseBody(req, tenantAdminSchema.partial());
    const [t] = await withAdmin((tx) =>
      tx
        .update(tenants)
        .set({ ...body, ...(body.domain !== undefined && { domain: body.domain || null }) })
        .where(eq(tenants.id, params.id))
        .returning(),
    );
    if (!t) notFound("Tenant");
    invalidateTenantCache();
    return t;
  },
  { minRole: "SUPER_ADMIN" },
);
