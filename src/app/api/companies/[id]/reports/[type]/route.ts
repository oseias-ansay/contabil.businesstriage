/**
 * GET /api/companies/:id/reports/:type
 *   balancete ?from&to
 *   razao     ?from&to&accountId
 *   dre       ?from&to&monthly=1
 *   balanco   ?asOf
 * Acrescente &format=pdf para baixar o PDF (com o aviso de natureza informativa).
 */
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { tenants } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { trialBalance } from "@/lib/ledger";
import { balanceSheet, generalLedger, incomeStatement } from "@/lib/reports";
import { balanceTable, incomeStatementTable, ledgerTable, renderReportPdf, trialBalanceTable } from "@/lib/pdf";
import { rangeFrom, requireCompany } from "@/lib/company-ctx";
import { formatDoc } from "@/lib/format";

const TYPES = ["balancete", "razao", "dre", "balanco"] as const;
type ReportType = (typeof TYPES)[number];
const dmy = (iso: string) => iso.split("-").reverse().join("/");

export const GET = route<{ id: string; type: string }>(async (req, { auth, params }) => {
  const type = params.type as ReportType;
  if (!TYPES.includes(type)) throw new ApiError(404, "Relatório desconhecido");
  const url = new URL(req.url);
  const pdf = url.searchParams.get("format") === "pdf";

  const { co, tenant, data } = await withTenant(auth.tenantId, async (tx) => {
    const co = await requireCompany(tx, params.id);
    const [tenant] = await tx.select({ name: tenants.name, color: tenants.primaryColor }).from(tenants).where(eq(tenants.id, auth.tenantId));
    let data: unknown;
    if (type === "balanco") {
      const asOf = url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ApiError(422, "Data inválida");
      data = await balanceSheet(tx, co.id, asOf);
    } else {
      const { from, to } = rangeFrom(url);
      if (type === "balancete") data = { from, to, rows: await trialBalance(tx, co.id, from, to) };
      if (type === "dre") data = await incomeStatement(tx, co.id, from, to, { monthly: url.searchParams.get("monthly") === "1" });
      if (type === "razao") {
        const accountId = url.searchParams.get("accountId");
        if (!accountId) throw new ApiError(422, "Escolha a conta do razão");
        data = await generalLedger(tx, co.id, accountId, from, to);
      }
    }
    return { co, tenant, data };
  });

  if (!pdf) return data;

  const header = {
    companyName: co.tradeName || co.legalName,
    companyDoc: [co.tradeName ? co.legalName : null, co.cnpj ? formatDoc(co.cnpj) : null].filter(Boolean).join(" · ") || null,
    tenantName: tenant.name,
    color: tenant.color,
  };
  let file: Buffer;
  let name: string;
  if (type === "balancete") {
    const d = data as { from: string; to: string; rows: Parameters<typeof trialBalanceTable>[0] };
    file = await renderReportPdf({ ...header, title: "Balancete de verificação", subtitle: `Período de ${dmy(d.from)} a ${dmy(d.to)}` }, [{ table: trialBalanceTable(d.rows) }]);
    name = `balancete_${d.from}_${d.to}`;
  } else if (type === "razao") {
    const d = data as Awaited<ReturnType<typeof generalLedger>>;
    file = await renderReportPdf({ ...header, title: `Razão — ${d.account.code} ${d.account.name}`, subtitle: `Período de ${dmy(d.from)} a ${dmy(d.to)}` }, [{ table: ledgerTable(d) }]);
    name = `razao_${d.account.code}_${d.from}_${d.to}`;
  } else if (type === "dre") {
    const d = data as Awaited<ReturnType<typeof incomeStatement>>;
    file = await renderReportPdf(
      { ...header, title: "Demonstração do resultado (DRE gerencial)", subtitle: `Competência de ${dmy(d.from)} a ${dmy(d.to)}`, landscape: d.months.length > 4 },
      [{ table: incomeStatementTable(d) }],
      "AV = análise vertical sobre a receita líquida do período.",
    );
    name = `dre_${d.from}_${d.to}`;
  } else {
    const d = data as Awaited<ReturnType<typeof balanceSheet>>;
    file = await renderReportPdf(
      { ...header, title: "Balanço patrimonial gerencial", subtitle: `Posição em ${dmy(d.asOf)}` },
      [
        { heading: "Ativo", table: balanceTable(d.assets) },
        { heading: "Passivo e patrimônio líquido", table: balanceTable(d.liabilities) },
      ],
      d.difference ? `Atenção: diferença de ${(d.difference / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} entre ativo e passivo + PL.` : "O resultado ainda não encerrado aparece no patrimônio líquido.",
    );
    name = `balanco_${d.asOf}`;
  }
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
