#!/usr/bin/env bash
# Publica a IA e instala a ponte do botão global, sempre por commit exato.
set -Eeuo pipefail
umask 077
REV="${1:?Informe o commit completo}"
MODE="${2:-check}"
[[ "$REV" =~ ^[0-9a-f]{40}$ && "$MODE" =~ ^(check|apply)$ ]]
[[ "$(id -u)" == 0 ]] || { echo 'Execute como root no servidor.' >&2; exit 1; }
for tool in node php git tar flock; do command -v "$tool" >/dev/null || { echo "Falta instalar: $tool" >&2; exit 1; }; done
exec 8>/run/lock/possebon-global-assistant.lock
flock -n 8 || { echo 'Outra instalação do botão global está em andamento.' >&2; exit 1; }
CURRENT=/opt/ada/current
test -d "$CURRENT/.git"
runuser -u ada -- git -C "$CURRENT" cat-file -e "$REV^{commit}"
if [[ -z "${POSSEBON_WEB_ROOT:-}" ]]; then
  candidates=()
  for parent in /var/www /srv/www; do
    if [[ -d "$parent" ]]; then
      while IFS= read -r source; do candidates+=("${source%/app/custom/AdaIntegrationService.php}"); done < <(find "$parent" -maxdepth 8 -type f -path '*/app/custom/AdaIntegrationService.php' 2>/dev/null)
    fi
  done
  mapfile -t candidates < <(printf '%s\n' "${candidates[@]}" | sed '/^$/d' | sort -u)
  if [[ "${#candidates[@]}" != 1 ]]; then
    printf 'Não foi possível identificar uma única pasta do POSSEBON com SSO. Nada foi alterado.\n' >&2
    printf 'Informe a pasta já existente com POSSEBON_WEB_ROOT=/caminho ao executar este script.\n' >&2
    exit 1
  fi
  POSSEBON_WEB_ROOT="${candidates[0]}"
fi
test -f "$POSSEBON_WEB_ROOT/init.php"
test -f "$POSSEBON_WEB_ROOT/app/custom/AdaIntegrationService.php"
STAGE="$(mktemp -d /var/tmp/possebon-global.XXXXXX)"
cleanup(){ case "$STAGE" in /var/tmp/possebon-global.*) rm -rf -- "$STAGE";; esac; }
trap cleanup EXIT
runuser -u ada -- git -C "$CURRENT" archive "$REV" \
  scripts/deploy/install-global-assistant.mjs scripts/deploy/update.sh \
  integration/possebon-web/ada-assistant.php integration/possebon-web/App/custom/AdaAssistantBridge.php \
  apps/web/public/possebon-assistant.js | tar -x -C "$STAGE" --no-same-owner
node "$STAGE/scripts/deploy/install-global-assistant.mjs" "$POSSEBON_WEB_ROOT" check
if [[ "$MODE" == check ]]; then echo 'Simulação concluída. Produção preservada.'; exit 0; fi
if [[ "$(runuser -u ada -- git -C "$CURRENT" rev-parse HEAD)" != "$REV" ]]; then
  bash "$STAGE/scripts/deploy/update.sh" "$REV"
fi
test "$(runuser -u ada -- git -C "$CURRENT" rev-parse HEAD)" == "$REV"
node "$CURRENT/scripts/deploy/install-global-assistant.mjs" "$POSSEBON_WEB_ROOT" apply
echo 'Conversa global instalada. Entre novamente no POSSEBON Web e recarregue a página.'
echo 'Valide um usuário com acesso, outro sem acesso e a troca de unidade. Preserve a inclusão no projeto MAD Builder.'
