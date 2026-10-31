#!/usr/bin/env bash
# Atualização por commit exato. Preserva configuração e releases anteriores.
set -Eeuo pipefail
umask 077
REF="${1:?Uso: sudo bash update.sh COMMIT_COMPLETO}"
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || { echo 'Informe o commit completo.'; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.'; exit 1; }
BASE=/opt/ada
REPO="${ADA_REPO:-https://github.com/pedrotorresepc13-glitch/ada-possebon.git}"
for command in git node npm pg_dump pg_restore flock systemctl runuser curl; do command -v "$command" >/dev/null; done
[[ -f /etc/ada/ada.env && -f /etc/ada/migrate.env ]] || { echo 'Configuração existente não encontrada.'; exit 1; }
exec 9>/run/lock/ada-update.lock
flock -n 9 || { echo 'Outra atualização está em andamento.'; exit 1; }
PREVIOUS="$(readlink -f "$BASE/current")"
[[ "$PREVIOUS" == "$BASE/releases/"* && -d "$PREVIOUS" && -L "$BASE/current" ]] || { echo 'Release atual fora da estrutura esperada.'; exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REL="$BASE/releases/$STAMP-${REF:0:12}"
BACKUP="/var/backups/ada/$STAMP-${REF:0:12}"
[[ ! -e "$REL" && ! -e "$BASE/current.new" ]] || { echo 'Destino já existe.'; exit 1; }
STOPPED=0
rollback(){
  local code=$?
  trap - ERR INT TERM
  if [[ "$STOPPED" == 1 ]]; then
    echo 'Falha: restaurando versão anterior. Backup preservado; nenhuma tabela será apagada.'
    ln -sfn "$PREVIOUS" "$BASE/current.new"
    mv -Tf "$BASE/current.new" "$BASE/current"
    systemctl restart ada-api ada-worker || true
  fi
  echo "Atualização não concluída. Release: $REL; backup (se criado): $BACKUP"
  [[ "$code" -ne 0 ]] || code=1
  exit "$code"
}
trap rollback ERR INT TERM
install -d -o ada -g ada -m 755 "$REL"
echo 'Preparando e validando código isolado. Serviços continuam ativos.'
runuser -u ada -- git clone --quiet "$REPO" "$REL"
runuser -u ada -- git -C "$REL" checkout --quiet --detach "$REF"
[[ "$(git -c safe.directory="$REL" -C "$REL" rev-parse HEAD)" == "$REF" ]]
cd "$REL"
runuser -u ada -- npm ci --no-audit --no-fund
runuser -u ada -- env -u DATABASE_URL -u ADA_ROOT -u ADA_ENV npm run ci
env -u DATABASE_URL node --env-file=/etc/ada/migrate.env scripts/deploy/release-data.mjs validate
echo 'Validação concluída. Parando serviços para backup consistente e migração.'
STOPPED=1
systemctl stop ada-worker ada-api
install -d -m 700 "$BACKUP"
cp -a /etc/ada "$BACKUP/configuracao"
printf '%s\n' "$PREVIOUS" > "$BACKUP/release-anterior.txt"
env -u DATABASE_URL node --env-file=/etc/ada/migrate.env scripts/deploy/release-data.mjs backup "$BACKUP/ada.dump"
env -u DATABASE_URL node --env-file=/etc/ada/migrate.env scripts/deploy/release-data.mjs snapshot "$BACKUP/dados-antes.json"
sha256sum "$BACKUP/ada.dump" > "$BACKUP/ada.dump.sha256"
env -u DATABASE_URL ADA_ROOT="$REL" ADA_ENV=production ADA_DB_DRIVER=pg node --env-file=/etc/ada/migrate.env apps/api/dist/migrate.mjs up
env -u DATABASE_URL node --env-file=/etc/ada/migrate.env scripts/deploy/release-data.mjs verify "$BACKUP/dados-antes.json"
ln -s "$REL" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
systemctl start ada-api ada-worker
node --env-file=/etc/ada/ada.env -e 'const{spawnSync}=require("node:child_process");const r=spawnSync("bash",["scripts/deploy/healthcheck.sh"],{env:process.env,stdio:"inherit"});process.exit(r.status??1)'
systemctl is-active --quiet ada-api ada-worker
STOPPED=0
trap - ERR INT TERM
echo "Atualização concluída: $REF"
echo "Backup: $BACKUP"
echo "Versão anterior preservada: $PREVIOUS"
