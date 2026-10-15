/**
 * ════════════════════════════════════════════════════════════════════
 *  Triage Contábil — Schema do banco (Drizzle ORM + PostgreSQL)
 * ════════════════════════════════════════════════════════════════════
 *  Mesmo modelo multi-tenant do Triage CRM: banco próprio + coluna
 *  `tenant_id` em TODAS as tabelas de negócio, com isolamento em duas
 *  camadas (withTenant() na aplicação + Row Level Security no Postgres).
 *
 *  Dentro de um tenant podem existir várias EMPRESAS contabilizadas
 *  (ex.: um grupo econômico, ou a carteira operada pela Business Triage).
 *  Plano de contas, lançamentos e períodos pertencem a uma empresa.
 *
 *  Regras contábeis garantidas pelo PRÓPRIO banco (drizzle/rules.sql):
 *   · débitos = créditos em todo lançamento (verificado no COMMIT)
 *   · só contas analíticas recebem lançamentos
 *   · nada entra em período fechado
 *   · lançamentos e auditoria são imutáveis (correção = estorno)
 *   · o mesmo evento externo não gera dois lançamentos (idempotência)
 *
 *  Valores monetários: numeric(18,2) — nunca float.
 *  Nomes camelCase no TS viram snake_case no banco (casing: "snake_case").
 * ════════════════════════════════════════════════════════════════════
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ───────────────────────────── ENUMS ─────────────────────────────

export const tenantStatus = pgEnum("tenant_status", ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELED"]);
export const planTier = pgEnum("plan_tier", ["STARTER", "PRO", "BUSINESS", "ENTERPRISE"]);
/**
 * Papéis (do maior para o menor):
 *  SUPER_ADMIN → Business Triage (Admin Global)
 *  OWNER       → dono da conta: equipe, marca, tudo do gestor
 *  MANAGER     → gestor: lança, fecha e reabre meses, vê tudo
 *  OPERATOR    → operador: lança, importa extratos, classifica
 *  VIEWER      → leitor: só consulta e exporta relatórios
 */
export const userRole = pgEnum("user_role", ["SUPER_ADMIN", "OWNER", "MANAGER", "OPERATOR", "VIEWER"]);

export const taxRegime = pgEnum("tax_regime", ["SIMPLES", "PRESUMIDO", "REAL", "MEI", "OUTRO"]);
export const accountType = pgEnum("account_type", ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
export const accountNature = pgEnum("account_nature", ["DEBIT", "CREDIT"]);
/** Grupo do balanço patrimonial (contas patrimoniais). */
export const balanceGroup = pgEnum("balance_group", ["AC", "ANC", "PC", "PNC", "PL"]);
/** Linha da DRE gerencial (contas de resultado). */
export const dreGroup = pgEnum("dre_group", [
  "RECEITA_BRUTA",
  "DEDUCOES",
  "CUSTOS",
  "DESPESAS_VENDAS",
  "DESPESAS_ADMINISTRATIVAS",
  "RECEITAS_FINANCEIRAS",
  "DESPESAS_FINANCEIRAS",
  "OUTRAS_RECEITAS",
  "OUTRAS_DESPESAS",
  "IR_CSLL",
]);
export const entrySource = pgEnum("entry_source", ["MANUAL", "OPENING", "REVERSAL", "BANK_IMPORT", "PLATFORM", "CLOSING"]);
export const periodStatus = pgEnum("period_status", ["OPEN", "CLOSED"]);
export const bankLineStatus = pgEnum("bank_line_status", ["PENDING", "POSTED", "IGNORED"]);
export const ruleDirection = pgEnum("rule_direction", ["ANY", "IN", "OUT"]);

// Colunas reutilizadas
const id = () => uuid().primaryKey().defaultRandom();
const tenantRef = () =>
  uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = () => numeric({ precision: 18, scale: 2 }).notNull().default("0");

// ───────────────────────────── TENANCY ─────────────────────────────

/** Configurações por tenant (guardadas em `tenants.settings`). */
export type TenantSettings = {
  smtp?: { host: string; port: number; user: string; pass: string; from: string };
  currency?: string; // "BRL"
};

export const tenants = pgTable("tenants", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(), // <slug>.contabil.businesstriage.com.br
  domain: text().unique(), // domínio próprio: contabil.cliente.com.br
  status: tenantStatus().notNull().default("TRIAL"),

  // White-label
  logoUrl: text(),
  faviconUrl: text(),
  primaryColor: text().notNull().default("#0F2A44"),
  secondaryColor: text().notNull().default("#14B8A6"),
  loginHeadline: text(),

  // Plano / limites
  plan: planTier().notNull().default("STARTER"),
  maxUsers: integer().notNull().default(3),
  maxCompanies: integer().notNull().default(1),
  enabledModules: text()
    .array()
    .notNull()
    .default(sql`ARRAY['ledger','reports']::text[]`),
  trialEndsAt: timestamp({ withTimezone: true }),

  settings: jsonb().$type<TenantSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default("VIEWER"),
    avatarUrl: text(),
    isActive: boolean().notNull().default(true),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.email), index().on(t.tenantId, t.role)],
);

export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    tenantId: tenantRef(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

// ───────────────────────────── EMPRESAS ─────────────────────────────

/** Referências cruzadas com os outros produtos do ecossistema. */
export type CompanyExternalRefs = {
  crmTenantSlug?: string;
  crmClientId?: string; // clients.id no Triage CRM
  platformAccountId?: string; // conta na Plataforma Business Triage
};

export const companies = pgTable(
  "companies",
  {
    id: id(),
    tenantId: tenantRef(),
    legalName: text().notNull(), // razão social
    tradeName: text(), // nome fantasia
    cnpj: text(), // só dígitos (CNPJ ou CPF)
    taxRegime: taxRegime().notNull().default("SIMPLES"), // informativo
    fiscalYearStartMonth: smallint().notNull().default(1),
    startDate: date().notNull(), // início da escrituração no sistema
    isActive: boolean().notNull().default(true),
    externalRefs: jsonb().$type<CompanyExternalRefs>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.tenantId),
    uniqueIndex("companies_tenant_cnpj_uq").on(t.tenantId, t.cnpj).where(sql`cnpj is not null`),
    check("companies_fy_month_ck", sql`fiscal_year_start_month between 1 and 12`),
  ],
);

// ───────────────────────────── PLANO DE CONTAS ─────────────────────────────

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    parentId: uuid().references((): AnyPgColumn => accounts.id, { onDelete: "no action" }),
    code: text().notNull(), // 1.1.1.01
    name: text().notNull(),
    level: smallint().notNull(), // 1 = grupo, 4 = analítica (no plano padrão)
    type: accountType().notNull(),
    nature: accountNature().notNull(),
    isAnalytic: boolean().notNull(), // só analíticas recebem lançamentos
    balanceGroup: balanceGroup(), // contas patrimoniais
    dreGroup: dreGroup(), // contas de resultado
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.companyId, t.code),
    index().on(t.tenantId, t.companyId),
    index().on(t.parentId),
    check("accounts_code_ck", sql`code ~ '^[0-9]+(\\.[0-9]+)*$'`),
    check(
      "accounts_group_ck",
      sql`(type in ('ASSET','LIABILITY','EQUITY') and dre_group is null) or (type in ('REVENUE','EXPENSE') and balance_group is null)`,
    ),
  ],
);

export const costCenters = pgTable(
  "cost_centers",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.companyId, t.code), index().on(t.tenantId, t.companyId)],
);

// ───────────────────────────── PERÍODOS ─────────────────────────────

/** Um registro por empresa e mês. Mês sem registro = aberto. */
export const periods = pgTable(
  "periods",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    competence: date().notNull(), // sempre o dia 1 do mês
    status: periodStatus().notNull().default("OPEN"),
    closedById: uuid().references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp({ withTimezone: true }),
    reopenedById: uuid().references(() => users.id, { onDelete: "set null" }),
    reopenedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.companyId, t.competence),
    index().on(t.tenantId, t.companyId),
    check("periods_first_day_ck", sql`extract(day from competence) = 1`),
  ],
);

// ───────────────────────────── LIVRO-RAZÃO ─────────────────────────────

/**
 * Cabeçalho do lançamento. Imutável depois de gravado: erros se corrigem
 * com um lançamento de estorno (reversesEntryId aponta para o original).
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    number: integer().notNull().default(0), // sequencial por empresa (definido pelo banco)
    entryDate: date().notNull(), // data de competência do fato
    competence: date().notNull().default(sql`date '1900-01-01'`), // 1º dia do mês (definido pelo banco)
    memo: text().notNull(), // histórico
    source: entrySource().notNull().default("MANUAL"),
    externalId: text(), // id do evento de origem (idempotência)
    reversesEntryId: uuid().references((): AnyPgColumn => journalEntries.id, { onDelete: "no action" }),
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdTx: bigint({ mode: "number" }).notNull().default(sql`txid_current()`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.companyId, t.number),
    uniqueIndex("journal_entries_external_uq").on(t.companyId, t.source, t.externalId).where(sql`external_id is not null`),
    uniqueIndex("journal_entries_reverses_uq").on(t.reversesEntryId).where(sql`reverses_entry_id is not null`),
    index().on(t.tenantId, t.companyId, t.competence),
  ],
);

/** Partidas (débito OU crédito, nunca os dois na mesma linha). */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    tenantId: tenantRef(),
    entryId: uuid()
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    costCenterId: uuid().references(() => costCenters.id, { onDelete: "no action" }),
    debit: money(),
    credit: money(),
    memo: text(), // histórico complementar
  },
  (t) => [
    uniqueIndex().on(t.entryId, t.lineNo),
    index().on(t.accountId),
    index().on(t.tenantId),
    check("journal_lines_side_ck", sql`debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0))`),
  ],
);

// ───────────────────────────── EXTRATOS BANCÁRIOS ─────────────────────────────

/** Arquivo de extrato importado para uma conta bancária (conta analítica do plano). */
export const bankImports = pgTable(
  "bank_imports",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    bankAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    fileName: text().notNull(),
    format: text().notNull(), // OFX | CSV
    firstDate: date(),
    lastDate: date(),
    linesTotal: integer().notNull().default(0), // linhas lidas do arquivo
    linesNew: integer().notNull().default(0), // linhas novas (as demais já tinham sido importadas)
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.companyId, t.createdAt)],
);

/** Uma movimentação do extrato. Vira um lançamento quando classificada e lançada. */
export const bankLines = pgTable(
  "bank_lines",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    importId: uuid()
      .notNull()
      .references(() => bankImports.id, { onDelete: "cascade" }),
    bankAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    lineDate: date().notNull(),
    amount: numeric({ precision: 18, scale: 2 }).notNull(), // + entrada, − saída
    description: text().notNull(),
    normalized: text().notNull(), // histórico normalizado (busca e regras)
    document: text(),
    dedupeKey: text().notNull(),
    status: bankLineStatus().notNull().default("PENDING"),
    accountId: uuid().references(() => accounts.id, { onDelete: "no action" }), // contrapartida escolhida/sugerida
    costCenterId: uuid().references(() => costCenters.id, { onDelete: "no action" }),
    suggestedBy: text(), // RULE | HISTORY | USER
    ruleId: uuid(),
    entryId: uuid().references(() => journalEntries.id, { onDelete: "no action" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bank_lines_dedupe_uq").on(t.bankAccountId, t.dedupeKey),
    index().on(t.tenantId, t.companyId, t.status, t.lineDate),
    index().on(t.importId),
    check("bank_lines_amount_ck", sql`amount <> 0`),
  ],
);

/** Regra de classificação: histórico contém o texto → conta (e centro de custo). */
export const classificationRules = pgTable(
  "classification_rules",
  {
    id: id(),
    tenantId: tenantRef(),
    companyId: companyRef(),
    pattern: text().notNull(), // texto normalizado procurado no histórico
    direction: ruleDirection().notNull().default("ANY"),
    bankAccountId: uuid().references(() => accounts.id, { onDelete: "cascade" }), // vazio = qualquer banco
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    costCenterId: uuid().references(() => costCenters.id, { onDelete: "set null" }),
    priority: integer().notNull().default(100), // menor = avaliada antes
    isActive: boolean().notNull().default(true),
    hits: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId, t.companyId, t.isActive), check("classification_rules_pattern_ck", sql`length(pattern) >= 3`)],
);

// ───────────────────────────── AUDITORIA ─────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: tenantRef(),
    // sem chave estrangeira: a trilha é imutável e sobrevive à exclusão da empresa ou do usuário
    companyId: uuid(),
    userId: uuid(),
    userName: text(),
    action: text().notNull(), // entry.post, entry.reverse, period.close, period.reopen, account.update…
    entity: text().notNull(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.companyId, t.createdAt)],
);

// ───────────────────────────── RELAÇÕES (db.query.*) ─────────────────────────────

export const companiesRelations = relations(companies, ({ many }) => ({
  accounts: many(accounts),
  entries: many(journalEntries),
}));
export const accountsRelations = relations(accounts, ({ one, many }) => ({
  company: one(companies, { fields: [accounts.companyId], references: [companies.id] }),
  parent: one(accounts, { fields: [accounts.parentId], references: [accounts.id], relationName: "tree" }),
  children: many(accounts, { relationName: "tree" }),
}));
export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  company: one(companies, { fields: [journalEntries.companyId], references: [companies.id] }),
  lines: many(journalLines),
}));
export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, { fields: [journalLines.entryId], references: [journalEntries.id] }),
  account: one(accounts, { fields: [journalLines.accountId], references: [accounts.id] }),
  costCenter: one(costCenters, { fields: [journalLines.costCenterId], references: [costCenters.id] }),
}));

// ───────────────────────────── TIPOS ─────────────────────────────

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type CostCenter = typeof costCenters.$inferSelect;
export type Period = typeof periods.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type BankImport = typeof bankImports.$inferSelect;
export type BankLine = typeof bankLines.$inferSelect;
export type ClassificationRule = typeof classificationRules.$inferSelect;
