/** POST /api/companies/:id/bank/imports (multipart: file, bankAccountId, mapping?, pdfPassword?) — importa o extrato. */
import { withTenant } from "@/db";
import { ApiError, route } from "@/lib/api";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";
import { importStatement, requireBankModule } from "@/lib/bank/service";
import { parseStatement, readStatementForm } from "@/lib/bank/http";

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const input = await readStatementForm(req);
    const { file, form } = input;
    const bankAccountId = form.get("bankAccountId");
    if (typeof bankAccountId !== "string" || !/^[0-9a-f-]{36}$/i.test(bankAccountId)) throw new ApiError(422, "Escolha a conta bancária do extrato");
    const parsed = await parseStatement(input);
    return withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      const co = await requireCompany(tx, params.id);
      const r = await importStatement(tx, ledgerCtx(auth), { companyId: co.id, bankAccountId, fileName: file.name, parsed });
      return Response.json({ ...r, warnings: parsed.warnings }, { status: 201 });
    });
  },
  { minRole: "OPERATOR" },
);
