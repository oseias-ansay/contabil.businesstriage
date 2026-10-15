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

## Estado atual

### Fase 0 (Fundação) concluída

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

### Fase 1 (Núcleo) concluída

Cada empresa tem cinco abas:

| Aba | O que faz |
|---|---|
| Lançamentos | lista por mês com busca e partidas expansíveis; novo lançamento com conferência de débitos e créditos em tempo real (e botão para completar a diferença); detalhe com autor e estorno |
| Relatórios | DRE gerencial (mês a mês, com análise vertical), balanço patrimonial, balancete e razão por conta (sintética soma as subcontas); todos exportam PDF com o aviso informativo |
| Fechamento | meses com status; conferências antes de fechar (bloqueios e avisos); fechar e reabrir, com auditoria |
| Plano de contas | árvore com busca; gestor cria subcontas (código automático), renomeia e inativa |
| Saldos de abertura | informa os saldos patrimoniais no início da escrituração e gera um lançamento; a diferença vai para 2.3.9.01 |

Papéis: operador lança e estorna; gestor também fecha e reabre meses, edita o plano de contas e lança saldos de abertura; leitor só consulta e exporta.

## Próximas fases

| Fase | Entrega |
|---|---|
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

### Testes

```bash
npm test                                   # regras do banco (24) + relatórios (8); cria e apaga tenants de teste
BASE_URL=http://localhost:3200 npm run test:api   # ponta a ponta pela API, com o servidor no ar e o seed carregado
```

- **Regras:** tentam gravar lançamento desbalanceado por SQL direto, alterar e apagar lançamentos,
  lançar em mês fechado, em conta sintética e na conta de outro tenant.
- **Relatórios:** DRE, balanço e razão contra números conferidos à mão.
- **API:** valores digitados em formato brasileiro ("1.234,56", "R$ 99,90") chegam ao banco exatos,
  regras devolvem 422 com mensagem clara e os PDFs são gerados.

> Ao refazer o seed com o servidor no ar, espere 1 minuto (cache de tenant) antes de entrar de novo.

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
├── tests/                   # regras do banco, relatórios e API ponta a ponta
└── src/
    ├── db/                      # schema, withTenant/withAdmin/withPurge, migrate, bootstrap, seed
    ├── lib/
    │   ├── ledger.ts            # empresas, lançamentos, estorno, períodos, fechamento, contas, abertura, balancete
    │   ├── reports.ts           # razão, DRE gerencial e balanço patrimonial
    │   ├── pdf.ts               # PDFs dos relatórios (pdfmake)
    │   ├── chart-of-accounts.ts # plano de contas padrão MPE
    │   ├── money.ts             # valores em centavos (nunca float)
    │   └── tenant.ts · auth.ts · session.ts · api.ts …
    ├── app/                     # páginas (painel, empresas, configuracoes, admin) e API
    └── components/
```
