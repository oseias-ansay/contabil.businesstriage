# Deploy na VPS — Docker + Traefik (instalação isolada)

O Triage Contábil entra na VPS como **mais um projeto Docker**, no mesmo padrão do Triage CRM e
totalmente separado dele. O site, o CRM, o n8n, o Supabase, a Evolution e o Traefik **não são
alterados**: o Contábil só se registra no Traefik pela rede `traefik-proxy`.

## 1. O que fica isolado

| Recurso | No Contábil | Isolamento |
|---|---|---|
| Projeto | `/opt/apps/triage-contabil` (Compose `triage-contabil`) | pasta e projeto próprios (`700` + segredos `600`) |
| Banco | container `triage-contabil-db` (Postgres 16) | **exclusivo**; rede `triage-contabil-internal` *interna* (sem internet, sem porta publicada); não compartilha nada com o banco do CRM |
| Usuário do banco | `triage_contabil` | **sem** superusuário e **sem** BYPASSRLS → Row Level Security e regras contábeis sempre ativos |
| App | container `triage-contabil-app` (porta interna 3200) | usuário sem privilégios, sistema de arquivos somente leitura, `cap_drop: ALL`, `no-new-privileges`, 1 GB de RAM / 1,5 CPU |
| Entrada | Traefik → `triage-contabil-app:3200` | nenhuma porta publicada no host |
| Rotas dos clientes | container `triage-contabil-routes` (busybox) | só carrega labels do Traefik; atualizar não reinicia o app |
| Volumes | `triage-contabil-pgdata`, `triage-contabil-uploads` | nomes próprios |
| Backups | `/opt/apps/triage-contabil/backups` + Google Drive (criptografado) | diário às 03:17 · 14 dias local · 30 dias no Drive |

## 2. Antes de instalar: DNS

No DNS de `businesstriage.com.br` (Hostinger):

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `contabil` | IP da VPS | 300 |
| A | `*.contabil` | IP da VPS | 300 |

Confira na VPS (deve mostrar o IP):

```bash
getent hosts contabil.businesstriage.com.br teste.contabil.businesstriage.com.br
```

> O Traefik só emite o SSL depois que o DNS aponta para a VPS. Se instalar antes, funciona do
> mesmo jeito: o certificado sai assim que o DNS propagar.

## 3. Instalação

Do seu computador (ou `git clone` do repositório direto na VPS):

```bash
scp triage-contabil.zip root@IP_DA_VPS:/root/
```

Na VPS:

```bash
cd /root && apt-get install -y unzip rsync && unzip -o triage-contabil.zip && cd triage-contabil
sudo ADMIN_NAME="Oseias" ADMIN_EMAIL="seu@email.com.br" bash deploy/docker/install.sh
```

O instalador faz, em ordem:

1. Verifica Docker, Compose, a rede `traefik-proxy` e o DNS.
2. Copia o projeto para `/opt/apps/triage-contabil` e gera os segredos (`.env` e `app.env`, `600`).
3. Constrói a imagem (2 a 5 min) e sobe o banco e o app. **A cada start** o app aplica as
   migrations, o RLS e as regras contábeis (`drizzle/rules.sql`), sempre de forma idempotente.
4. Cria o tenant Business Triage e o Super Admin. A senha fica em `/root/triage-contabil-admin.txt`.
5. Gera as rotas dos clientes e instala o cron (`/etc/cron.d/triage-contabil`).
6. Testa `https://contabil.businesstriage.com.br/api/health` pelo Traefik.

Depois:

- Acesse `https://contabil.businesstriage.com.br` com o e-mail e a senha de
  `/root/triage-contabil-admin.txt`. **Apague esse arquivo depois do primeiro login.**
- Para o "Esqueci minha senha" funcionar, preencha o SMTP em `/opt/apps/triage-contabil/app.env`
  e rode `docker compose up -d app`. Sem SMTP, o dono redefine senhas em Configurações → Equipe.

## 4. Clientes white-label e SSL

O Traefik usa o desafio TLS-ALPN, que não emite certificado wildcard. Cada cliente recebe um
certificado próprio, automaticamente:

1. Admin Global → **Novo cliente** (slug `acme`).
2. Em até 2 minutos o `sync-domains.sh` (cron) publica `acme.contabil.businesstriage.com.br`.
3. No primeiro acesso, o Traefik emite o SSL desse subdomínio.

**Domínio próprio do cliente** (`contabil.acme.com.br`): o cliente cria
`CNAME contabil.acme.com.br → acme.contabil.businesstriage.com.br` e você cadastra o domínio no
tenant. O cron publica a rota e o Traefik emite o SSL.

Para forçar na hora: `sudo bash /opt/apps/triage-contabil/deploy/docker/sync-domains.sh`.

## 5. Operação

```bash
cd /opt/apps/triage-contabil
docker compose ps                                        # status dos 3 containers
docker compose logs -f app                               # logs do app
nano app.env && docker compose up -d app                 # mudar SMTP etc.
bash deploy/docker/backup.sh                             # backup manual
docker compose exec db psql -U postgres triage_contabil  # console do banco
```

**Atualizar** (nova versão descompactada em `/root/triage-contabil`):

```bash
cd /root/triage-contabil && sudo bash deploy/docker/update.sh
```

O script faz backup, constrói a nova imagem e sobe. Se ela não ficar saudável, **volta sozinho
para a imagem anterior**.

**Restaurar o banco:**

```bash
cd /opt/apps/triage-contabil
docker compose exec -T db pg_restore -U postgres -d triage_contabil --clean < backups/db_AAAA-MM-DD_HHMM.dump
```

> Atenção: as regras de imutabilidade valem também no restore. Restaure sempre o dump inteiro
> (`--clean`), nunca tabelas soltas de lançamentos.

### Backup fora da VPS (Google Drive)

Mesmo procedimento do CRM, com remote e pasta próprios (`triagecontabil-gdrive`,
`TriageContabil-backups`):

1. No Windows: `.\rclone.exe authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="` e copie o
   bloco `{"access_token":...}`.
2. Na VPS: `sudo bash /opt/apps/triage-contabil/deploy/docker/offsite-setup.sh` e cole o bloco.
3. Guarde a chave de criptografia mostrada uma única vez. Sem ela, os backups do Drive não abrem.

**Remover o Contábil por completo** (não afeta nada mais):

```bash
cd /opt/apps/triage-contabil && docker compose down -v && rm -f /etc/cron.d/triage-contabil
```

## 6. Como o isolamento funciona

```
Traefik (Host: acme.contabil.businesstriage.com.br) ──► triage-contabil-app
   ├─ src/lib/tenant.ts: domínio próprio → subdomínio <slug> → host desconhecido = "Endereço não encontrado"
   ├─ layout aplica cores, logo e favicon do tenant
   ├─ login aceita só usuários daquele tenant; o JWT carrega o tenantId e não vale em outro host
   └─ withTenant() → SET app.tenant_id → o Postgres (RLS) devolve só linhas do tenant
         └─ triggers de drizzle/rules.sql garantem partidas dobradas, período fechado,
            imutabilidade e conta analítica, mesmo se a aplicação errar
```

Antes de liberar para clientes pagantes, configure o backup externo (seção 5).
