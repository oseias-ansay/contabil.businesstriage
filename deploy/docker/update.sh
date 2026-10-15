#!/usr/bin/env bash
# Atualiza o Triage Contábil: backup → código novo → build → sobe; volta a imagem anterior se falhar.
#   sudo bash deploy/docker/update.sh   (executado na pasta da NOVA versão)
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute com sudo."; exit 1; }
APP_DIR=/opt/apps/triage-contabil
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

echo "• Backup preventivo…"; APP_DIR=$APP_DIR bash deploy/docker/backup.sh
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  echo "• Copiando código…"
  rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude data --exclude docs/screenshots \
    --exclude .env --exclude app.env --exclude compose.routes.yml --exclude backups \
    "$SRC_DIR/" "$APP_DIR/"
fi
docker tag triage-contabil:latest triage-contabil:previous
echo "• Build…"; docker compose build --pull app
echo "• Subindo nova versão…"; docker compose up -d app
for _ in $(seq 1 90); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' triage-contabil-app)" == healthy ]] && { bash deploy/docker/sync-domains.sh; echo "✔ Atualizado e no ar"; exit 0; }
  sleep 2
done
echo "✖ Nova versão não ficou saudável — voltando para a anterior"
docker compose logs --tail 40 app
docker tag triage-contabil:previous triage-contabil:latest
docker compose up -d --no-build app
exit 1
