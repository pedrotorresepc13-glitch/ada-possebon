#!/usr/bin/env bash
# Atualização isolada do botão. Nunca seleciona release, reinicia serviço ou migra banco.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
REV="${1:?Informe o commit validado}"
[[ "$REV" =~ ^[a-f0-9]{40}$ ]] || exit 1
WEB=/var/www/html/possebon_app
exec 9>/run/lock/ada-update.lock
flock -n 9 || { echo 'Outra atualização em andamento. Nada alterado.' >&2; exit 1; }
ANTES="$(readlink -f /opt/ada/current)"
test -f "$WEB/ada-assistant.php"
test -f "$WEB/app/custom/AdaAssistantBridge.php"
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4800/ada/healthz >/dev/null
runuser -u ada -- git -C /opt/ada/current cat-file -e "$REV^{commit}"
mkdir -p /var/backups/ada
PACOTE="$(mktemp -d /var/backups/ada/widget-controls-package.XXXXXX)"
runuser -u ada -- git -C /opt/ada/current archive "$REV" \
  scripts/deploy/install-widget-controls.mjs \
  integration/possebon-web/public/possebon-assistant-global.js | tar -x -C "$PACOTE"
node --check "$PACOTE/scripts/deploy/install-widget-controls.mjs"
node --check "$PACOTE/integration/possebon-web/public/possebon-assistant-global.js"
node "$PACOTE/scripts/deploy/install-widget-controls.mjs" "$WEB" check
node "$PACOTE/scripts/deploy/install-widget-controls.mjs" "$WEB" apply
[[ "$(readlink -f /opt/ada/current)" == "$ANTES" ]]
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4800/ada/healthz >/dev/null
printf 'Botão atualizado. Versão da IA preservada: %s\n' "$ANTES"
echo 'Sem reinício, migração ou alteração de PHP, rotas e configuração.'
echo 'Recarregue uma página do POSSEBON. Teste também um usuário autorizado sem sessão prévia na IA.'

# Apenas diagnóstico: usa o ambiente do processo em execução, sem mostrar segredos.
PID="$(systemctl show ada-api --property=MainPID --value)"
ADA_DIAG_PID="$PID" node --input-type=module <<'JS'
import fs from 'node:fs';
try {
  const pid=process.env.ADA_DIAG_PID;
  if(!/^[1-9][0-9]*$/.test(pid??'')) throw Error('Processo da API não localizado');
  const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
  const url=new URL(env.POSSEBON_IDENTITY_URL);
  url.searchParams.set('system_user_id','230');
  const r=await fetch(url,{headers:{Authorization:`Bearer ${env.POSSEBON_SERVICE_TOKEN}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  const data=await r.json().catch(()=>null);
  const valid=r.ok&&Number(data?.system_user_id)===230&&data?.units?.some(u=>Number(u.id)===3);
  console.log(JSON.stringify({diagnostico:'identidade efetiva da API',endpoint:url.origin+url.pathname,http:r.status,identidadeEPC13:!!valid}));
  if(!valid) console.log('ATENÇÃO: a identificação de novas sessões precisa ser corrigida no servidor. A sessão já aberta do Pedro não comprova o acesso de outros usuários. Configuração preservada.');
} catch(e) { console.log('Identificação de novas sessões ainda não validada: '+(e.cause?.code??e.code??e.name)+'. Nenhuma configuração alterada.'); }
JS
