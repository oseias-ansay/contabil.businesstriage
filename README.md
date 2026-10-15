# Triage Contábil — Contabilidade gerencial SaaS (Business Triage)

Módulo de contabilidade **gerencial** da Business Triage. Transforma a movimentação da empresa em
balancete, DRE e balanço **informativos**, sem responsabilidade técnica de contador e sem
obrigações fiscais. É uma aplicação independente, no mesmo padrão do Triage CRM: banco próprio,
multi-tenant, white-label e deploy isolado. Integra-se ao CRM e à Plataforma por API (fase 3).

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · Tailwind · Radix UI · Lucide · TanStack Query |
| Backend | Route Handlers do Next |
| Banco | PostgreSQL 16 + **Drizzle ORM** + **Row Level Security** + regras contábeis em triggers |
| Deploy | Docker + Traefik, projeto `triage-contabil` isolado (ver `docs/DEPLOY.md`) |

> Todo demonstrativo leva o aviso: *demonstrativo gerencial, de caráter informativo, não substitui
> a escrituração contábil oficial nem as demonstrações assinadas por contador habilitado.*

---

## Estado atual — Fase 0 (Fundação) concluída

- **Base comum** reaproveitada do CRM: login, sessão JWT por tenant, esqueci minha senha,
  white-label (logo, favicon, cores, domínio próprio), Admin Global, equipe com papéis.
- **Papéis:** Super Admin (Business Triage) · Dono · Gestor · Operador · Leitor.
- **Empresas:** um tenant pode ter várias empresas (grupo econômico ou carteira operada pela
  Business Triage), com limite por plano.
- **Plano de contas padrão para MPE** (149 contas, 99 analíticas, 4 níveis), aplicado a cada empresa
  nova, já com o grupo do balanço ou a linha da DRE em cada conta.
- **Livro-razão** (`src/lib/ledger.ts`): lançar, estornar, fechar e reabrir mês, balancete com saldo
  anterior e agregação nas contas sintéticas, trilha de auditoria.
- **Regras garantidas pelo próprio Postgres** (`drizzle/rules.sql`), testadas em `tests/`:

| Regra | Como o banco garante |
|---|---|
| Débitos = créditos, mínimo 2 partidas | trigger de constraint checado no COMMIT |
| Partida é débito OU crédito | `CHECK` na tabela |
| Só conta analítica, ativa e da mesma empresa | trigger antes de inserir a partida |
| Nada entra em mês fechado | trigger antes de inserir o lançamento |
| Lançamentos e auditoria imutáveis | trigger bloqueia `UPDATE`/`DELETE` (correção = estorno) |
| Não acrescentar partidas a lançamento antigo | partidas só na mesma transação do cabeçalho |
| Estorno único | índice único em `reverses_entry_id` |
| Mesmo evento externo não duplica | índice único (empresa, origem, `external_id`) |
| Conta movimentada não muda tipo/natureza nem é excluída | trigger no plano de contas |
| Isolamento entre clientes | Row Level Security com `FORCE` |

Telas desta fase: Painel, Empresas, Plano de contas (árvore com busca), Configurações (marca e
equipe) e Admin Global.

## Próximas fases

| Fase | Entrega |
|---|---|
| 1 · Núcleo | tela de lançamentos e estorno, fechamento mensal com checklist, balancete, razão, DRE e balanço em PDF, edição do plano de contas, saldos de abertura |
| 2 · Extratos | importação OFX/CSV, regras de classificação, classificação em lote |
| 3 · Integrações | eventos da Plataforma, webhook do CRM ("cliente contratado" cria a empresa), API de relatórios e `period.closed` |
| 4 · Evolução | indicadores, comparativos, refinamentos de white-label, avaliação de Open Finance |

---

## Desenvolvimento local

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # Postgres 16 na porta 5434, usuário sem BYPASSRLS
npm install
npm run db:migrate                                # migrations + RLS + regras contábeis
npm run db:seed                                   # tenants de exemplo + empresa com 7 lançamentos
npm run dev                                       # http://localhost:3200
```

- Super Admin: `admin@businesstriage.com.br` / `Triage@2026`
- Outro tenant: `http://localhost:3200/?tenant=demo-cliente` → `dono@demo.com.br` / `Triage@2026`

### Testes das regras contábeis

```bash
npm run test:db     # usa o DATABASE_URL do .env; cria e apaga 2 tenants de teste
```

Os 24 testes tentam, entre outras coisas, gravar lançamento desbalanceado por SQL direto, alterar e
apagar lançamentos, lançar em mês fechado, em conta sintética e na conta de outro tenant.

### Alterar o schema

Edite `src/db/schema.ts`, rode `npm run db:generate` (gera a migration em `drizzle/`) e depois
`npm run db:migrate`. Regras de banco que não cabem no Drizzle vão em `drizzle/rules.sql`
(sempre idempotente: `CREATE OR REPLACE` e `DROP TRIGGER IF EXISTS`).

## Estrutura

```
triage-contabil/
├── drizzle/
│   ├── 0000_init.sql            # migration gerada do schema
│   ├── rls.sql                  # Row Level Security (todas as tabelas com tenant_id)
│   └── rules.sql                # regras contábeis em triggers
├── deploy/docker/               # install, update, backup, offsite, sync-domains, initdb
├── docs/DEPLOY.md               # publicação na VPS
├── tests/ledger-rules.test.ts   # testes das regras contra Postgres real
└── src/
    ├── db/                      # schema, withTenant/withAdmin/withPurge, migrate, bootstrap, seed
    ├── lib/
    │   ├── ledger.ts            # empresas, lançamentos, estorno, períodos, balancete, auditoria
    │   ├── chart-of-accounts.ts # plano de contas padrão MPE
    │   ├── money.ts             # valores em centavos (nunca float)
    │   └── tenant.ts · auth.ts · session.ts · api.ts …
    ├── app/                     # páginas (painel, empresas, configuracoes, admin) e API
    └── components/
```
