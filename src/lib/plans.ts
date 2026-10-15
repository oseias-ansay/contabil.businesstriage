/** Planos e módulos disponíveis por tenant. */
export const MODULES = [
  { key: "ledger", label: "Plano de contas e lançamentos" },
  { key: "reports", label: "Relatórios (balancete, DRE, balanço)" },
  { key: "bank", label: "Importação de extratos" },
  { key: "integrations", label: "Integrações (CRM, Plataforma, API)" },
] as const;

export const PLAN_PRESETS = {
  STARTER: { maxUsers: 3, maxCompanies: 1, modules: ["ledger", "reports"] },
  PRO: { maxUsers: 5, maxCompanies: 3, modules: ["ledger", "reports", "bank"] },
  BUSINESS: { maxUsers: 15, maxCompanies: 20, modules: MODULES.map((m) => m.key) },
  ENTERPRISE: { maxUsers: 100, maxCompanies: 500, modules: MODULES.map((m) => m.key) },
} as const;

/** Nome dos papéis na interface. */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  OWNER: "Dono",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  VIEWER: "Leitor",
};
