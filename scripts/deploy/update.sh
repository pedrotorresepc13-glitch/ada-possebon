#!/usr/bin/env bash
# =============================================================================
# ADA POSSEBON — atualização com backup, migrations, troca atômica e rollback automático.
# Uso (no servidor, como usuário com sudo):  sudo -E scripts/deploy/update.sh <tag-ou-commit>
# Pré-requisitos: /etc/ada/ada.env, /etc/ada/migrate.env (DATABASE_URL do ada_owner), Node 22+, pg_dump.
# NÃO executar sem autorização da infraestrutura.
# =============================================================================
set -euo pipefail

REF="${1:?informe a tag/commit a implantar}"
REPO="${ADA_REPO:-https://github.com/pedrotorresepc13-glitch/holo-gestures.git}"
BASE=/opt/ada
REL="$BASE/releases/$(date +%Y%m%d%H%M%S)-${REF//\//_}"
CURRENT="$BASE/current"
PREVIOUS="$(readlink -f "$CURRENT" || true)"

echo "==> Preparando release $REL"
sudo -u ada git clone --quiet "$REPO" "$REL"
sudo -u ada git -C "$REL" checkout --quiet "$REF"
cd "$REL"
sudo -u ada npm ci --no-audit --no-fund
sudo -u ada npm run build

echo "==> Backup do schema ada antes das migrations"
"$REL/scripts/deploy/backup.sh"

echo "==> Migrations (ada_owner)"
sudo -u ada env $(grep -v '^#' /etc/ada/migrate.env | xargs) ADA_ENV=production ADA_ROOT="$REL" \
  node "$REL/apps/api/dist/migrate.mjs" up

echo "==> Troca atômica do release"
ln -sfn "$REL" "$CURRENT.new" && mv -Tf "$CURRENT.new" "$CURRENT"
systemctl restart ada-api ada-worker

echo "==> Verificação de saúde"
if ! "$REL/scripts/deploy/healthcheck.sh"; then
  echo "!! Saúde falhou — voltando para $PREVIOUS (o banco permanece migrado; ver rollback.sh)"
  if [ -n "$PREVIOUS" ]; then ln -sfn "$PREVIOUS" "$CURRENT.new" && mv -Tf "$CURRENT.new" "$CURRENT"; systemctl restart ada-api ada-worker; fi
  exit 1
fi
echo "==> OK: $(readlink -f "$CURRENT")"
# Mantém os 5 releases mais recentes
ls -1dt "$BASE"/releases/* | tail -n +6 | xargs -r rm -rf
