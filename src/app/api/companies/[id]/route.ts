/**
 * GET   /api/companies/:id — dados da empresa
 * PATCH /api/companies/:id — cadastro (gestor+). CNPJ e início da escrituração
 *       ficam fixos depois que a empresa tem lançamentos.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { companies, journalEntries } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";
import { audit, companyInputSchema } from "@/lib/ledger";

export const GET = route<{ id: string }>(async (_req, { auth, params }) => {
  const [c] = await withTenant(auth.tenantId, (tx) => tx.select().from(companies).where(eq(companies.id, params.id)));
  if (!c) notFound("Empresa", true);
  return c;
});

const patchSchema = companyInputSchema.partial().extend({ isActive: z.boolean().optional() });

export const PATCH = route<{ id: string }>(
  async (req, { auth, params }) => {
    const body = await parseBody(req, patchSchema);
    return withTenant(auth.tenantId, async (tx) => {
      const [c] = await tx.select().from(companies).where(eq(companies.id, params.id));
      if (!c) notFound("Empresa", true);
      const [hasEntries] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.companyId, c.id)).limit(1);
      const changesCnpj = body.cnpj !== undefined && body.cnpj !== c.cnpj;
      const changesStart = body.startDate !== undefined && body.startDate !== c.startDate;
      if (hasEntries && (changesCnpj || changesStart)) {
        throw new ApiError(409, "Empresa com lançamentos: CNPJ e início da escrituração não podem mudar");
      }
      const { externalRefs, ...rest } = body;
      const [updated] = await tx
        .update(companies)
        .set({ ...rest, ...(externalRefs && { externalRefs: { ...c.externalRefs, ...externalRefs } }) })
        .where(eq(companies.id, c.id))
        .returning();
      await audit(tx, { tenantId: auth.tenantId, userId: auth.userId, userName: auth.name }, { companyId: c.id, action: "company.update", entity: "company", entityId: c.id, before: c, after: updated });
      return updated;
    });
  },
  { minRole: "MANAGER" },
);
