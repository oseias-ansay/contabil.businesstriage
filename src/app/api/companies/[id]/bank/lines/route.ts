/** GET /api/companies/:id/bank/lines?status&bankAccountId&from&to&q&page — movimentos do extrato. */
import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/db";
import { accounts, bankLines, journalEntries } from "@/db/schema";
import { route } from "@/lib/api";
import { requireCompany } from "@/lib/company-ctx";
import { requireBankModule } from "@/lib/bank/service";
import { normalizeText } from "@/lib/bank/text";

const PAGE = 100;
const STATUS = ["PENDING", "POSTED", "IGNORED"] as const;

export const GET = route<{ id: string }>(async (req, { auth, params }) => {
  const url = new URL(req.url);
  const status = (STATUS as readonly string[]).includes(url.searchParams.get("status") ?? "") ? (url.searchParams.get("status") as (typeof STATUS)[number]) : "PENDING";
  const bankAccountId = url.searchParams.get("bankAccountId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const q = url.searchParams.get("q")?.trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const iso = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

  return withTenant(auth.tenantId, async (tx) => {
    await requireBankModule(tx, auth.tenantId);
    const co = await requireCompany(tx, params.id);
    const bank = alias(accounts, "bank");
    const where = and(
      eq(bankLines.companyId, co.id),
      eq(bankLines.status, status),
      bankAccountId && /^[0-9a-f-]{36}$/i.test(bankAccountId) ? eq(bankLines.bankAccountId, bankAccountId) : undefined,
      iso(from) ? gte(bankLines.lineDate, iso(from)!) : undefined,
      iso(to) ? lte(bankLines.lineDate, iso(to)!) : undefined,
      q ? ilike(bankLines.normalized, `%${normalizeText(q)}%`) : undefined,
    );
    const [{ total, inflow, outflow }] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        inflow: sql<string>`coalesce(sum(case when ${bankLines.amount} > 0 then ${bankLines.amount} end), 0)`,
        outflow: sql<string>`coalesce(sum(case when ${bankLines.amount} < 0 then ${bankLines.amount} end), 0)`,
      })
      .from(bankLines)
      .where(where);
    const rows = await tx
      .select({
        id: bankLines.id,
        lineDate: bankLines.lineDate,
        amount: bankLines.amount,
        description: bankLines.description,
        document: bankLines.document,
        status: bankLines.status,
        suggestedBy: bankLines.suggestedBy,
        accountId: bankLines.accountId,
        accountCode: accounts.code,
        accountName: accounts.name,
        bankCode: bank.code,
        bankName: bank.name,
        entryId: bankLines.entryId,
        entryNumber: journalEntries.number,
      })
      .from(bankLines)
      .leftJoin(accounts, eq(accounts.id, bankLines.accountId))
      .innerJoin(bank, eq(bank.id, bankLines.bankAccountId))
      .leftJoin(journalEntries, eq(journalEntries.id, bankLines.entryId))
      .where(where)
      .orderBy(status === "PENDING" ? asc(bankLines.lineDate) : desc(bankLines.lineDate), asc(bankLines.description))
      .limit(PAGE)
      .offset((page - 1) * PAGE);
    return { total, inflow, outflow, page, pageSize: PAGE, lines: rows };
  });
});
