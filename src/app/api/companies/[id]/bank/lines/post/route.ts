/**
 * POST /api/companies/:id/bank/lines/post { lineIds } — lança os movimentos escolhidos.
 * Cada movimento vai na própria transação: um mês fechado ou uma linha sem conta
 * não impede os demais. A resposta diz o que foi lançado e o motivo de cada recusa.
 */
import { z } from "zod";
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { ledgerCtx, requireCompany } from "@/lib/company-ctx";
import { LedgerError } from "@/lib/ledger";
import { postBankLine, requireBankModule, suggestAccounts } from "@/lib/bank/service";

const schema = z.object({ lineIds: z.array(z.string().uuid()).min(1).max(500) });

function reason(e: unknown) {
  if (e instanceof LedgerError) return e.message;
  const pg = (e as { cause?: { code?: string; message?: string } })?.cause ?? (e as { code?: string; message?: string });
  if (pg?.code === "P0001" && pg.message) return pg.message;
  console.error("[bank.post]", e);
  return "Erro inesperado ao lançar";
}

export const POST = route<{ id: string }>(
  async (req, { auth, params }) => {
    const { lineIds } = await parseBody(req, schema);
    await withTenant(auth.tenantId, async (tx) => {
      await requireBankModule(tx, auth.tenantId);
      await requireCompany(tx, params.id);
    });
    const ctx = ledgerCtx(auth);
    const posted: { lineId: string; entryNumber: number }[] = [];
    const failed: { lineId: string; error: string }[] = [];
    for (const lineId of [...new Set(lineIds)]) {
      try {
        const e = await withTenant(auth.tenantId, (tx) => postBankLine(tx, ctx, params.id, lineId));
        posted.push({ lineId, entryNumber: e.number });
      } catch (e) {
        failed.push({ lineId, error: reason(e) });
      }
    }
    // o que acabou de ser lançado ensina o histórico: atualiza as sugestões dos pendentes
    if (posted.length) await withTenant(auth.tenantId, (tx) => suggestAccounts(tx, params.id));
    return { posted, failed };
  },
  { minRole: "OPERATOR" },
);
