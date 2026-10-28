#!/usr/bin/env bash
# Rollback da ADA.
#   scripts/deploy/rollback.sh                → volta o código para o release anterior (banco intacto)
#   scripts/deploy/rollback.sh --db <dump>    → também restaura o schema a partir de um backup
# Migrations são aditivas por política; reverter schema só com backup verificado (0001 down apaga tudo).
set -euo pipefail
BASE=/opt/ada
CURRENT="$(readlink -f "$BASE/current")"
PREV="$(ls -1dt "$BASE"/releases/* | grep -v "^$CURRENT$" | head -n 1)"
[ -n "$PREV" ] || { echo "Nenhum release anterior"; exit 1; }
systemctl stop ada-worker ada-api
if [ "${1:-}" = "--db" ]; then
  DUMP="${2:?informe o arquivo .dump}"
  set -a; . /etc/ada/migrate.env; set +a
  pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP"
fi
ln -sfn "$PREV" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
systemctl start ada-api ada-worker
"$PREV/scripts/deploy/healthcheck.sh"
echo "Rollback para $PREV concluído"
