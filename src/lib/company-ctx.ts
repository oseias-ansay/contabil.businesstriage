/** Helpers das rotas por empresa: confere que a empresa é do tenant e monta o contexto do livro. */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { companies, type Company } from "@/db/schema";
import { ApiError, notFound } from "./api";
import type { AuthContext } from "./auth";
import type { LedgerCtx } from "./ledger";

export async function requireCompany(tx: Tx, companyId: string): Promise<Company> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound("Empresa", true);
  const [c] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!c) notFound("Empresa", true);
  return c;
}

export const ledgerCtx = (auth: AuthContext): LedgerCtx => ({ tenantId: auth.tenantId, userId: auth.userId, userName: auth.name });

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Lê ?from=&to= (padrão: mês atual). */
export function rangeFrom(url: URL) {
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = url.searchParams.get("to") ?? today;
  if (!ISO.test(from) || !ISO.test(to) || from > to) throw new ApiError(422, "Período inválido: use AAAA-MM-DD e início antes do fim");
  return { from, to };
}
