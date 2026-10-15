#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Sincroniza as rotas do Traefik com os clientes (tenants) cadastrados.
#  Para cada tenant ativo publica <slug>.DOMAIN e, se houver, o domínio
#  próprio — cada um com seu certificado (Traefik / Let's Encrypt).
#  Só recria o container "routes" (alguns ms) quando algo mudou; o app
#  não é reiniciado. Roda a cada 2 min via /etc/cron.d/triage-contabil.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/apps/triage-contabil}"
cd "$APP_DIR"
DOMAIN=$(sed -n 's/^DOMAIN=//p' .env | tr -d '"')
OUT=compose.routes.yml
TMP=$(mktemp)

HOSTS=""
if docker compose ps --status running db 2>/dev/null | grep -q triage-contabil-db; then
  HOSTS=$(docker compose exec -T db psql -U postgres -d triage_contabil -AtX -c "
    SELECT lower(slug) || '.$DOMAIN' FROM tenants WHERE status IN ('ACTIVE','TRIAL')
    UNION
    SELECT lower(domain) FROM tenants WHERE domain IS NOT NULL AND domain <> '' AND status IN ('ACTIVE','TRIAL')
    ORDER BY 1" 2>/dev/null || true)
fi

{
  echo "# GERADO por deploy/docker/sync-domains.sh — não edite à mão"
  echo "services:"
  echo "  routes:"
  echo "    labels:"
  echo "      traefik.enable: \"true\""
  echo "      traefik.docker.network: traefik-proxy"
  echo "      traefik.http.services.triagecont-routes-noop.loadbalancer.server.port: \"80\""
  for h in $HOSTS; do
    [[ "$h" =~ ^[a-z0-9.-]+$ ]] || continue
    [[ "$h" == "$DOMAIN" ]] && continue
    id="tcont-$(echo "$h" | tr '.' '-')"
    cat <<YML
      traefik.http.routers.$id.rule: Host(\`$h\`)
      traefik.http.routers.$id.entrypoints: websecure
      traefik.http.routers.$id.tls.certresolver: letsencrypt
      traefik.http.routers.$id.service: triagecont@docker
      traefik.http.routers.$id.middlewares: triagecont-headers@docker,triagecont-rl@docker
      traefik.http.routers.$id-login.rule: Host(\`$h\`) && Path(\`/api/auth/login\`)
      traefik.http.routers.$id-login.priority: "1000"
      traefik.http.routers.$id-login.entrypoints: websecure
      traefik.http.routers.$id-login.tls.certresolver: letsencrypt
      traefik.http.routers.$id-login.service: triagecont@docker
      traefik.http.routers.$id-login.middlewares: triagecont-headers@docker,triagecont-login-rl@docker
      traefik.http.routers.$id-http.rule: Host(\`$h\`)
      traefik.http.routers.$id-http.entrypoints: web
      traefik.http.routers.$id-http.service: triagecont@docker
      traefik.http.routers.$id-http.middlewares: triagecont-https@docker
YML
  done
} > "$TMP"

if [[ -f "$OUT" ]] && cmp -s "$TMP" "$OUT"; then
  rm -f "$TMP"; exit 0
fi
mv "$TMP" "$OUT"; chmod 640 "$OUT"
if [[ "${1:-}" != "--no-apply" ]]; then
  docker compose up -d --no-deps routes >/dev/null 2>&1
  echo "✔ Rotas atualizadas: $(echo "$HOSTS" | grep -c . || true) host(s) de clientes"
fi
