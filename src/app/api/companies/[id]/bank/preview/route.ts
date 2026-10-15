/**
 * POST /api/companies/:id/bank/preview (multipart: file, mapping?)
 * Lê o extrato sem gravar nada: formato, colunas detectadas (CSV), amostra e totais.
 */
import { withTenant } from "@/db";
import { route } from "@/lib/api";
import { requireCompany } from "@/lib/company-ctx";
import { requireBankModule } from "@/lib/bank/service";
import { parseStatement, readStatementForm } from "@/lib/bank/http";

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    await withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      await requireCompany(tx, params.id);
    });
    const { file, text, mapping } = await readStatementForm(req);
    const r = parseStatement(text, mapping);
    const inflow = r.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const outflow = r.lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0);
    const dates = r.lines.map((l) => l.date).sort();
    return {
      fileName: file.name,
      format: r.format,
      warnings: r.warnings,
      bank: r.bank,
      count: r.lines.length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      inflow,
      outflow,
      lines: r.lines.slice(0, 15),
      csv: r.guess ? { mapping: mapping ?? { ...r.guess, columns: undefined, sample: undefined }, columns: r.guess.columns, sample: r.guess.sample } : null,
    };
  },
  { minRole: "OPERATOR" },
);
