CREATE TYPE "public"."account_nature" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."balance_group" AS ENUM('AC', 'ANC', 'PC', 'PNC', 'PL');--> statement-breakpoint
CREATE TYPE "public"."dre_group" AS ENUM('RECEITA_BRUTA', 'DEDUCOES', 'CUSTOS', 'DESPESAS_VENDAS', 'DESPESAS_ADMINISTRATIVAS', 'RECEITAS_FINANCEIRAS', 'DESPESAS_FINANCEIRAS', 'OUTRAS_RECEITAS', 'OUTRAS_DESPESAS', 'IR_CSLL');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('MANUAL', 'OPENING', 'REVERSAL', 'BANK_IMPORT', 'PLATFORM', 'CLOSING');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."tax_regime" AS ENUM('SIMPLES', 'PRESUMIDO', 'REAL', 'MEI', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'OWNER', 'MANAGER', 'OPERATOR', 'VIEWER');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level" smallint NOT NULL,
	"type" "account_type" NOT NULL,
	"nature" "account_nature" NOT NULL,
	"is_analytic" boolean NOT NULL,
	"balance_group" "balance_group",
	"dre_group" "dre_group",
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_code_ck" CHECK (code ~ '^[0-9]+(\.[0-9]+)*$'),
	CONSTRAINT "accounts_group_ck" CHECK ((type in ('ASSET','LIABILITY','EQUITY') and dre_group is null) or (type in ('REVENUE','EXPENSE') and balance_group is null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"user_name" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"cnpj" text,
	"tax_regime" "tax_regime" DEFAULT 'SIMPLES' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"external_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_fy_month_ck" CHECK (fiscal_year_start_month between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"entry_date" date NOT NULL,
	"competence" date DEFAULT date '1900-01-01' NOT NULL,
	"memo" text NOT NULL,
	"source" "entry_source" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"reverses_entry_id" uuid,
	"created_by_id" uuid,
	"created_tx" bigint DEFAULT txid_current() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"memo" text,
	CONSTRAINT "journal_lines_side_ck" CHECK (debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0)))
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"competence" date NOT NULL,
	"status" "period_status" DEFAULT 'OPEN' NOT NULL,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone,
	"reopened_by_id" uuid,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_first_day_ck" CHECK (extract(day from competence) = 1)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text,
	"status" "tenant_status" DEFAULT 'TRIAL' NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text DEFAULT '#0F2A44' NOT NULL,
	"secondary_color" text DEFAULT '#14B8A6' NOT NULL,
	"login_headline" text,
	"plan" "plan_tier" DEFAULT 'STARTER' NOT NULL,
	"max_users" integer DEFAULT 3 NOT NULL,
	"max_companies" integer DEFAULT 1 NOT NULL,
	"enabled_modules" text[] DEFAULT ARRAY['ledger','reports']::text[] NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_journal_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_reopened_by_id_users_id_fk" FOREIGN KEY ("reopened_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_id_code_index" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "accounts_tenant_id_company_id_index" ON "accounts" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "accounts_parent_id_index" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_company_id_created_at_index" ON "audit_log" USING btree ("tenant_id","company_id","created_at");--> statement-breakpoint
CREATE INDEX "companies_tenant_id_index" ON "companies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_tenant_cnpj_uq" ON "companies" USING btree ("tenant_id","cnpj") WHERE cnpj is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_company_id_code_index" ON "cost_centers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "cost_centers_tenant_id_company_id_index" ON "cost_centers" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_id_number_index" ON "journal_entries" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_external_uq" ON "journal_entries" USING btree ("company_id","source","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reverses_uq" ON "journal_entries" USING btree ("reverses_entry_id") WHERE reverses_entry_id is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_id_company_id_competence_index" ON "journal_entries" USING btree ("tenant_id","company_id","competence");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_entry_id_line_no_index" ON "journal_lines" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "journal_lines_account_id_index" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_tenant_id_index" ON "journal_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "password_resets_user_id_index" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "periods_company_id_competence_index" ON "periods" USING btree ("company_id","competence");--> statement-breakpoint
CREATE INDEX "periods_tenant_id_company_id_index" ON "periods" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_id_email_index" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "users_tenant_id_role_index" ON "users" USING btree ("tenant_id","role");