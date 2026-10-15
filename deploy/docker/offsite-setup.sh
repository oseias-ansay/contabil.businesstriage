#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Configura a cópia diária dos backups do Triage Contábil no Google Drive
#  (criptografada com AES-256 antes de sair da VPS).
#
#  1) No seu computador (Windows), gere o token de acesso ao Drive:
#       rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="
#     (abre o navegador → entre na conta Google → copie o JSON exibido)
#  2) Na VPS:
#       sudo bash deploy/docker/offsite-setup.sh
#     e cole o JSON quando pedido.
#
#  Escopo "drive.file": o rclone só enxerga os arquivos que ELE criou —
#  não tem acesso ao resto do seu Google Drive.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute com sudo."; exit 1; }
APP_DIR="${APP_DIR:-/opt/apps/triage-contabil}"
REMOTE="triagecontabil-gdrive"
KEYFILE="$APP_DIR/.backup-key"

command -v rclone >/dev/null || { echo "• Instalando rclone…"; apt-get update -qq && apt-get install -y -qq rclone >/dev/null; }

if ! rclone listremotes 2>/dev/null | grep -qx "$REMOTE:"; then
  echo "Cole o JSON do token gerado pelo 'rclone authorize' (uma linha, começa com {\"access_token\"…) e tecle Enter:"
  read -r TOKEN
  [[ "$TOKEN" == \{*\} ]] || { echo "✖ Isso não parece o JSON do token."; exit 1; }
  rclone config create "$REMOTE" drive scope=drive.file token="$TOKEN" config_is_local=false --non-interactive >/dev/null
  chmod 600 "$(rclone config file | tail -1)"
  echo "✔ Conta Google conectada"
fi

if [[ ! -f "$KEYFILE" ]]; then
  umask 077; openssl rand -base64 48 | tr -d '\n' > "$KEYFILE"; umask 022
  echo
  echo "════════════════ CHAVE DE CRIPTOGRAFIA DOS BACKUPS ════════════════"
  cat "$KEYFILE"; echo
  echo "═══════════════════════════════════════════════════════════════════"
  echo "⚠ GUARDE esta chave num gerenciador de senhas. Sem ela, os backups"
  echo "  do Google Drive NÃO podem ser restaurados se a VPS for perdida."
  echo
fi

echo "• Testando envio…"
echo "teste $(date -Iseconds)" | rclone rcat "$REMOTE:TriageContabil-backups/.teste-conexao" && rclone deletefile "$REMOTE:TriageContabil-backups/.teste-conexao"
echo "✔ Google Drive pronto (pasta TriageContabil-backups)"
echo "• Executando um backup completo agora…"
export APP_DIR; bash "$APP_DIR/deploy/docker/backup.sh"
rclone ls "$REMOTE:TriageContabil-backups" | tail -3
