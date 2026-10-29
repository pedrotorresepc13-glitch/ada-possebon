#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd /var/www/html/possebon_app
archive="$1"
mode="$2"
expected='56fd9ca8bdd8c1949502970a21fa331d5d00d0705dd93b7d0dacab1d6b7a430d'
current="$(sha256sum app/routes/api.php | cut -d' ' -f1)"
if [ "$current" != "$expected" ]; then
  echo 'BLOQUEADO: api.php foi atualizado apos o ZIP 28/10. Nada alterado.' >&2
  exit 2
fi
if [ "$mode" != check ] && [ "$mode" != apply ]; then exit 2; fi
files='app/custom/AdaIntegrationService.php app/custom/AdaIdentityApiTrait.php app/custom/AdaBrainApiTrait.php app/controller/AdaApiController.php app/control/AdaEmbedView.php'
for file in $files; do
  if [ -e "$file" ]; then echo "BLOQUEADO: $file ja existe." >&2; exit 2; fi
done
for dir in app/routes app/custom app/controller app/control; do
  if [ ! -w "$dir" ]; then echo "BLOQUEADO: $dir sem permissao." >&2; exit 2; fi
done
tmp="$(mktemp -d /tmp/ada-sso-stage-XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$archive" -C "$tmp" --no-same-owner
for file in $files; do
  test -f "$tmp/$file"
  php -l "$tmp/$file"
done
python3 - app/routes/api.php "$tmp/route-candidate.php" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_bytes()
if b'/api/ada/v1' in source or b'AdaApiController::identidadeAda' in source:
    raise SystemExit('BLOQUEADO: rotas ADA ja declaradas.')
patch=b"\n\n/* ADA POSSEBON: rotas isoladas, sem alterar o ApiAppController */\nRouter::group(['prefix' => '/api/ada/v1'], function () {\n    Router::get('/identity', 'AdaApiController::identidadeAda');\n    Router::post('/brain/context', 'AdaApiController::contextoBrainAda');\n});\n"
Path(sys.argv[2]).write_bytes(source.rstrip(b'\r\n')+patch)
PY
php -l "$tmp/route-candidate.php"
echo "SHA original validado: $current"
echo 'ApiAppController: preservado.'
if [ "$mode" = check ]; then echo 'PREVIEW OK: producao inalterada.'; exit 0; fi
backup="$HOME/ada-sso-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
chmod 700 "$HOME/ada-sso-backups" "$backup"
cp -p app/routes/api.php "$backup/api.php"
rolled=0
rollback() {
  code=$?
  trap - ERR
  if [ "$code" -ne 0 ]; then
    cp -p "$backup/api.php" app/routes/api.php || true
    if [ "$rolled" = 1 ]; then
      for file in $files; do rm -f "$file" || true; done
    fi
    echo 'FALHA: rollback executado.' >&2
  fi
  exit "$code"
}
trap rollback ERR
rolled=1
for file in $files; do install -m 0644 "$tmp/$file" "$file"; done
install -m 0644 "$tmp/route-candidate.php" app/routes/.api.php.ada-stage
mv -f app/routes/.api.php.ada-stage app/routes/api.php
php -l app/routes/api.php
for file in $files; do php -l "$file"; done
trap - ERR
echo "ADA SSO instalado com backup em $backup"
echo 'Rotas e metodos preexistentes preservados; falta configurar segredos/HTTPS.'
