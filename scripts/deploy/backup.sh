#!/usr/bin/env bash
# Backup do schema da ADA (ada + ada_migrations), formato custom, com retenção.
# Variáveis: ADA_BACKUP_DIR (padrão /var/backups/ada), ADA_BACKUP_KEEP (padrão 14), DATABASE_URL via /etc/ada/migrate.env
set -euo pipefail
DIR="${ADA_BACKUP_DIR:-/var/backups/ada}"
KEEP="${ADA_BACKUP_KEEP:-14}"
mkdir -p "$DIR"
chmod 700 "$DIR"
# shellcheck disable=SC1091
[ -f /etc/ada/migrate.env ] && set -a && . /etc/ada/migrate.env && set +a
FILE="$DIR/ada-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --schema=ada --schema=ada_migrations --file="$FILE" "$DATABASE_URL"
pg_restore --list "$FILE" > /dev/null   # valida que o arquivo é legível
echo "Backup: $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t "$DIR"/ada-*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm -f
# Restauração (manual, após parar os serviços):
#   pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" <arquivo.dump>
