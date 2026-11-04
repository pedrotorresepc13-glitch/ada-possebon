#!/usr/bin/env bash
# Publica a IA e instala a ponte do botão global, sempre por commit exato.
set -Eeuo pipefail
umask 077
STEP='validar argumentos e ferramentas'
trap 'status=$?; printf "Instalação interrompida: etapa %s, linha %s, código %s.\n" "$STEP" "$LINENO" "$status" >&2; exit "$status"' ERR
echo 'Iniciando verificação do botão global.'
REV="${1:?Informe o commit completo}"
MODE="${2:-check}"
[[ "$REV" =~ ^[0-9a-f]{40}$ && "$MODE" =~ ^(check|apply|bridge)$ ]]
[[ "$(id -u)" == 0 ]] || { echo 'Execute como root no servidor.' >&2; exit 1; }
for tool in node php git tar flock cmp grep; do command -v "$tool" >/dev/null || { echo "Falta instalar: $tool" >&2; exit 1; }; done
exec 8>/run/lock/possebon-global-assistant.lock
flock -n 8 || { echo 'Outra instalação do botão global está em andamento.' >&2; exit 1; }
CURRENT=/opt/ada/current
STEP='validar repositório da versão atual'
# Releases podem ser worktrees: nesse caso .git é um ARQUIVO, não uma pasta.
# Conferir a raiz também evita aceitar por engano o repositório de uma pasta superior.
repo_root="$(runuser -u ada -- git -C "$CURRENT" rev-parse --show-toplevel)"
[[ "$(readlink -f "$repo_root")" == "$(readlink -f "$CURRENT")" ]] || { echo 'A pasta atual não é a raiz do repositório esperado.' >&2; exit 1; }
runuser -u ada -- git -C "$CURRENT" cat-file -e "$REV^{commit}"
STEP='localizar instalação POSSEBON com SSO'
echo 'Localizando a instalação POSSEBON com SSO.'
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
printf 'Instalação encontrada: %s\n' "$POSSEBON_WEB_ROOT"
STEP='preparar arquivos e simular instalação'
STAGE="$(mktemp -d /var/tmp/possebon-global.XXXXXX)"
cleanup(){ case "$STAGE" in /var/tmp/possebon-global.*) rm -rf -- "$STAGE";; esac; }
trap cleanup EXIT
runuser -u ada -- git -C "$CURRENT" archive "$REV" \
  scripts/deploy/install-global-assistant.mjs scripts/deploy/update.sh \
  integration/possebon-web/ada-assistant.php integration/possebon-web/App/custom/AdaAssistantBridge.php \
  apps/web/public/possebon-assistant.js | tar -x -C "$STAGE" --no-same-owner
node "$STAGE/scripts/deploy/install-global-assistant.mjs" "$POSSEBON_WEB_ROOT" check
if [[ "$MODE" == check ]]; then echo 'Simulação concluída. Produção preservada.'; exit 0; fi
STEP='atualizar e validar a IA'
if [[ "$MODE" == bridge ]]; then
  STEP='conferir compatibilidade da IA já publicada'
  # Repara somente a ponte: a IA precisa já conter a conversa global e a troca SSO compacta.
  runuser -u ada -- git -C "$CURRENT" merge-base --is-ancestor 5cee3d70066f6ff0697575d53cc8f4f683d68ff5 HEAD || { echo 'A IA ainda precisa da atualização de conversa global.' >&2; exit 1; }
  cmp -s "$STAGE/apps/web/public/possebon-assistant.js" "$CURRENT/apps/web/dist/possebon-assistant.js" || { echo 'O botão compilado difere do pacote. Revisão necessária antes de instalar.' >&2; exit 1; }
  echo 'IA compatível confirmada. Instalando somente a ponte; serviços e banco preservados.'
elif [[ "$(runuser -u ada -- git -C "$CURRENT" rev-parse HEAD)" != "$REV" ]]; then
  bash "$STAGE/scripts/deploy/update.sh" "$REV"
fi
if [[ "$MODE" != bridge ]]; then test "$(runuser -u ada -- git -C "$CURRENT" rev-parse HEAD)" == "$REV"; fi
STEP='instalar ponte e inclusão nos layouts'
# Executa o pacote validado e compara os arquivos antes de anunciar sucesso.
node "$STAGE/scripts/deploy/install-global-assistant.mjs" "$POSSEBON_WEB_ROOT" apply
cmp -s "$STAGE/integration/possebon-web/ada-assistant.php" "$POSSEBON_WEB_ROOT/ada-assistant.php"
cmp -s "$STAGE/integration/possebon-web/App/custom/AdaAssistantBridge.php" "$POSSEBON_WEB_ROOT/app/custom/AdaAssistantBridge.php"
while IFS= read -r layout; do
  grep -Fq '<!-- POSSEBON GLOBAL ASSISTANT v1 -->' "$layout"
done < <(find "$POSSEBON_WEB_ROOT/app/templates" -mindepth 2 -maxdepth 2 -type f -name libraries_user.html)
echo 'Arquivos da ponte e inclusões nos layouts conferidos.'
echo 'Conversa global instalada. Entre novamente no POSSEBON Web e recarregue a página.'
echo 'Valide um usuário com acesso, outro sem acesso e a troca de unidade. Preserve a inclusão no projeto MAD Builder.'
