/**
 * Plano de contas padrão para micro e pequenas empresas (gerencial).
 *
 * Estrutura usual brasileira em 4 níveis:
 *   1 Ativo · 2 Passivo e PL · 3 Receitas · 4 Custos e despesas
 *   nível 1 = grupo · 2 = subgrupo · 3 = conta sintética · 4 = conta analítica (recebe lançamentos)
 *
 * Cada conta já traz o grupo do balanço (patrimoniais) ou a linha da DRE
 * (resultado), para que balanço e DRE saiam prontos e no formato que as
 * análises de balanço da Business Triage leem.
 *
 * Natureza: herdada do grupo, exceto nas contas redutoras marcadas com "(-)".
 */
import type { Tx } from "@/db";
import { accounts } from "@/db/schema";

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
type Nature = "DEBIT" | "CREDIT";
type BalanceGroup = "AC" | "ANC" | "PC" | "PNC" | "PL";
type DreGroup =
  | "RECEITA_BRUTA"
  | "DEDUCOES"
  | "CUSTOS"
  | "DESPESAS_VENDAS"
  | "DESPESAS_ADMINISTRATIVAS"
  | "RECEITAS_FINANCEIRAS"
  | "DESPESAS_FINANCEIRAS"
  | "OUTRAS_RECEITAS"
  | "OUTRAS_DESPESAS"
  | "IR_CSLL";

export type ChartNode = {
  code: string;
  name: string;
  type: AccountType;
  nature: Nature;
  balanceGroup?: BalanceGroup;
  dreGroup?: DreGroup;
  children?: ChartNode[];
};

type Leaf = { name: string; nature?: Nature };

/** Monta uma conta sintética de nível 3 com suas analíticas numeradas .01, .02… */
function group(code: string, name: string, base: Omit<ChartNode, "code" | "name" | "children">, leaves: Leaf[]): ChartNode {
  return {
    code,
    name,
    ...base,
    children: leaves.map((l, i) => ({ code: `${code}.${String(i + 1).padStart(2, "0")}`, ...base, name: l.name, ...(l.nature && { nature: l.nature }) })),
  };
}

const leaf = (name: string): Leaf => ({ name });
/** Conta redutora: natureza oposta à do grupo. */
const contra = (name: string, nature: Nature): Leaf => ({ name, nature });

const A_AC = { type: "ASSET", nature: "DEBIT", balanceGroup: "AC" } as const;
const A_ANC = { type: "ASSET", nature: "DEBIT", balanceGroup: "ANC" } as const;
const L_PC = { type: "LIABILITY", nature: "CREDIT", balanceGroup: "PC" } as const;
const L_PNC = { type: "LIABILITY", nature: "CREDIT", balanceGroup: "PNC" } as const;
const E_PL = { type: "EQUITY", nature: "CREDIT", balanceGroup: "PL" } as const;
const rev = (dreGroup: DreGroup) => ({ type: "REVENUE", nature: "CREDIT", dreGroup }) as const;
const exp = (dreGroup: DreGroup) => ({ type: "EXPENSE", nature: "DEBIT", dreGroup }) as const;

export const STANDARD_CHART: ChartNode[] = [
  {
    code: "1", name: "ATIVO", type: "ASSET", nature: "DEBIT",
    children: [
      {
        code: "1.1", name: "ATIVO CIRCULANTE", ...A_AC,
        children: [
          group("1.1.1", "Disponibilidades", A_AC, [leaf("Caixa"), leaf("Bancos conta movimento"), leaf("Aplicações financeiras de liquidez imediata")]),
          group("1.1.2", "Créditos", A_AC, [
            leaf("Clientes a receber"),
            leaf("Cartões a receber"),
            contra("(-) Perdas estimadas com clientes", "CREDIT"),
            leaf("Adiantamentos a fornecedores"),
            leaf("Adiantamentos a empregados"),
            leaf("Tributos a recuperar"),
          ]),
          group("1.1.3", "Estoques", A_AC, [leaf("Mercadorias para revenda"), leaf("Matérias-primas"), leaf("Produtos acabados")]),
          group("1.1.4", "Despesas antecipadas", A_AC, [leaf("Seguros a apropriar"), leaf("Outras despesas antecipadas")]),
        ],
      },
      {
        code: "1.2", name: "ATIVO NÃO CIRCULANTE", ...A_ANC,
        children: [
          group("1.2.1", "Realizável a longo prazo", A_ANC, [leaf("Empréstimos a sócios"), leaf("Depósitos judiciais")]),
          group("1.2.2", "Investimentos", A_ANC, [leaf("Participações em outras empresas")]),
          group("1.2.3", "Imobilizado", A_ANC, [
            leaf("Máquinas e equipamentos"),
            leaf("Móveis e utensílios"),
            leaf("Veículos"),
            leaf("Equipamentos de informática"),
            leaf("Imóveis"),
            contra("(-) Depreciação acumulada", "CREDIT"),
          ]),
          group("1.2.4", "Intangível", A_ANC, [leaf("Softwares, marcas e licenças"), contra("(-) Amortização acumulada", "CREDIT")]),
        ],
      },
    ],
  },
  {
    code: "2", name: "PASSIVO E PATRIMÔNIO LÍQUIDO", type: "LIABILITY", nature: "CREDIT",
    children: [
      {
        code: "2.1", name: "PASSIVO CIRCULANTE", ...L_PC,
        children: [
          group("2.1.1", "Fornecedores", L_PC, [leaf("Fornecedores")]),
          group("2.1.2", "Obrigações trabalhistas", L_PC, [
            leaf("Salários a pagar"),
            leaf("Pró-labore a pagar"),
            leaf("INSS a recolher"),
            leaf("FGTS a recolher"),
            leaf("Férias e 13º salário a pagar"),
          ]),
          group("2.1.3", "Obrigações tributárias", L_PC, [
            leaf("Simples Nacional a recolher"),
            leaf("Tributos sobre o faturamento a recolher"),
            leaf("IRPJ e CSLL a recolher"),
            leaf("Parcelamentos tributários"),
          ]),
          group("2.1.4", "Empréstimos e financiamentos", L_PC, [
            leaf("Empréstimos bancários"),
            leaf("Cartão de crédito empresarial"),
            leaf("Cheque especial e conta garantida"),
          ]),
          group("2.1.5", "Outras obrigações", L_PC, [leaf("Adiantamentos de clientes"), leaf("Contas a pagar diversas"), leaf("Lucros a distribuir")]),
        ],
      },
      {
        code: "2.2", name: "PASSIVO NÃO CIRCULANTE", ...L_PNC,
        children: [
          group("2.2.1", "Empréstimos e financiamentos de longo prazo", L_PNC, [leaf("Empréstimos bancários"), leaf("Financiamentos de bens")]),
          group("2.2.2", "Outras obrigações de longo prazo", L_PNC, [leaf("Empréstimos de sócios"), leaf("Parcelamentos tributários")]),
        ],
      },
      {
        // PL fica sob o grupo 2 por convenção, mas com tipo próprio
        code: "2.3", name: "PATRIMÔNIO LÍQUIDO", ...E_PL,
        children: [
          group("2.3.1", "Capital social", E_PL, [leaf("Capital subscrito"), contra("(-) Capital a integralizar", "DEBIT")]),
          group("2.3.2", "Reservas", E_PL, [leaf("Reserva legal"), leaf("Reservas de lucros")]),
          group("2.3.3", "Lucros ou prejuízos acumulados", E_PL, [leaf("Lucros acumulados"), contra("(-) Prejuízos acumulados", "DEBIT")]),
          group("2.3.9", "Ajustes de implantação", E_PL, [leaf("Contrapartida de saldos de abertura")]),
        ],
      },
    ],
  },
  {
    code: "3", name: "RECEITAS", type: "REVENUE", nature: "CREDIT",
    children: [
      { code: "3.1", name: "RECEITA OPERACIONAL BRUTA", ...rev("RECEITA_BRUTA"), children: [
        group("3.1.1", "Vendas e serviços", rev("RECEITA_BRUTA"), [leaf("Venda de mercadorias"), leaf("Venda de produtos"), leaf("Prestação de serviços")]),
      ] },
      // Deduções: tipo receita (redutora), natureza devedora
      { code: "3.2", name: "DEDUÇÕES DA RECEITA BRUTA", type: "REVENUE", nature: "DEBIT", dreGroup: "DEDUCOES", children: [
        group("3.2.1", "Deduções", { type: "REVENUE", nature: "DEBIT", dreGroup: "DEDUCOES" }, [
          leaf("Simples Nacional e tributos sobre vendas"),
          leaf("Devoluções e cancelamentos"),
          leaf("Descontos incondicionais"),
        ]),
      ] },
      { code: "3.3", name: "RECEITAS FINANCEIRAS", ...rev("RECEITAS_FINANCEIRAS"), children: [
        group("3.3.1", "Receitas financeiras", rev("RECEITAS_FINANCEIRAS"), [leaf("Rendimentos de aplicações"), leaf("Juros recebidos"), leaf("Descontos obtidos")]),
      ] },
      { code: "3.4", name: "OUTRAS RECEITAS", ...rev("OUTRAS_RECEITAS"), children: [
        group("3.4.1", "Outras receitas", rev("OUTRAS_RECEITAS"), [leaf("Venda de bens do imobilizado"), leaf("Outras receitas")]),
      ] },
    ],
  },
  {
    code: "4", name: "CUSTOS E DESPESAS", type: "EXPENSE", nature: "DEBIT",
    children: [
      { code: "4.1", name: "CUSTOS", ...exp("CUSTOS"), children: [
        group("4.1.1", "Custos das vendas e serviços", exp("CUSTOS"), [
          leaf("Custo das mercadorias vendidas"),
          leaf("Custo dos produtos vendidos"),
          leaf("Custo dos serviços prestados"),
        ]),
      ] },
      { code: "4.2", name: "DESPESAS COM VENDAS", ...exp("DESPESAS_VENDAS"), children: [
        group("4.2.1", "Despesas comerciais", exp("DESPESAS_VENDAS"), [
          leaf("Comissões sobre vendas"),
          leaf("Marketing e publicidade"),
          leaf("Fretes sobre vendas"),
          leaf("Taxas de cartão e meios de pagamento"),
        ]),
      ] },
      { code: "4.3", name: "DESPESAS ADMINISTRATIVAS", ...exp("DESPESAS_ADMINISTRATIVAS"), children: [
        group("4.3.1", "Pessoal", exp("DESPESAS_ADMINISTRATIVAS"), [
          leaf("Salários"),
          leaf("Encargos sociais (INSS e FGTS)"),
          leaf("Benefícios"),
          leaf("Pró-labore"),
          leaf("Férias e 13º salário"),
        ]),
        group("4.3.2", "Ocupação", exp("DESPESAS_ADMINISTRATIVAS"), [
          leaf("Aluguel e condomínio"),
          leaf("Energia elétrica"),
          leaf("Água e esgoto"),
          leaf("Telefone e internet"),
        ]),
        group("4.3.3", "Gerais", exp("DESPESAS_ADMINISTRATIVAS"), [
          leaf("Honorários contábeis"),
          leaf("Consultorias e serviços de terceiros"),
          leaf("Softwares e sistemas"),
          leaf("Material de escritório e limpeza"),
          leaf("Manutenção e conservação"),
          leaf("Seguros"),
          leaf("Combustível, viagens e deslocamentos"),
          leaf("Tributos e taxas (IPTU, alvarás)"),
          leaf("Depreciação e amortização"),
          leaf("Despesas diversas"),
        ]),
      ] },
      { code: "4.4", name: "DESPESAS FINANCEIRAS", ...exp("DESPESAS_FINANCEIRAS"), children: [
        group("4.4.1", "Despesas financeiras", exp("DESPESAS_FINANCEIRAS"), [
          leaf("Juros pagos"),
          leaf("Tarifas bancárias"),
          leaf("IOF"),
          leaf("Multas e juros de mora"),
          leaf("Descontos concedidos"),
        ]),
      ] },
      { code: "4.5", name: "OUTRAS DESPESAS", ...exp("OUTRAS_DESPESAS"), children: [
        group("4.5.1", "Outras despesas", exp("OUTRAS_DESPESAS"), [leaf("Perdas com clientes"), leaf("Baixa de bens do imobilizado"), leaf("Outras despesas")]),
      ] },
      { code: "4.6", name: "TRIBUTOS SOBRE O LUCRO", ...exp("IR_CSLL"), children: [
        group("4.6.1", "IRPJ e CSLL", exp("IR_CSLL"), [leaf("IRPJ"), leaf("CSLL")]),
      ] },
    ],
  },
];

/** Achata a árvore na ordem de inserção (mães antes das filhas). */
export function flattenChart(nodes: ChartNode[] = STANDARD_CHART, parentCode: string | null = null) {
  const out: (Omit<ChartNode, "children"> & { parentCode: string | null; level: number; isAnalytic: boolean })[] = [];
  for (const n of nodes) {
    const { children, ...rest } = n;
    out.push({ ...rest, parentCode, level: n.code.split(".").length, isAnalytic: !children?.length });
    if (children?.length) out.push(...flattenChart(children, n.code));
  }
  return out;
}

/**
 * Aplica o plano de contas padrão a uma empresa recém-criada.
 * Contas de grupo de nível 1 e 2 sem grupo de balanço/DRE (ATIVO, RECEITAS…)
 * ficam sem grupo; as demais herdam do nó acima.
 */
export async function applyStandardChart(tx: Tx, tenantId: string, companyId: string) {
  const ids = new Map<string, string>();
  for (const n of flattenChart()) {
    const isResult = n.type === "REVENUE" || n.type === "EXPENSE";
    const [row] = await tx
      .insert(accounts)
      .values({
        tenantId,
        companyId,
        parentId: n.parentCode ? ids.get(n.parentCode)! : null,
        code: n.code,
        name: n.name,
        level: n.level,
        type: n.type,
        nature: n.nature,
        isAnalytic: n.isAnalytic,
        balanceGroup: isResult ? null : (n.balanceGroup ?? null),
        dreGroup: isResult ? (n.dreGroup ?? null) : null,
      })
      .returning({ id: accounts.id });
    ids.set(n.code, row.id);
  }
  return ids.size;
}
