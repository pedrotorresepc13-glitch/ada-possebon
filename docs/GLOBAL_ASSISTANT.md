# Conversa global no POSSEBON Web

O botão aparece no layout compartilhado para usuários autenticados com AdaEmbedView ou AdaAdministracao na sessão do POSSEBON e unidade vinculada. Não precisa visitar o painel da IA primeiro. O SSO existente continua responsável por emitir os tickets; a API da IA revalida a identidade autoritativa e suas permissões. Não concede nenhum programa novo.

## Fluxo

1. O layout carrega `/ada/possebon-assistant.js`. Não há iframe, ticket ou chamada ao modelo nessa etapa.
2. GET `ada-assistant.php` confere login, programas e unidade da sessão. Sem acesso, o botão não é montado. A resposta privada não fica em cache e inclui um nonce CSRF.
3. Ao clicar, o navegador confere novamente a sessão e pede um ticket por POST com CSRF. Usuário e unidade nunca vêm do corpo ou da URL.
4. Um formulário POST envia o ticket de 60 segundos ao endpoint existente `api/ada/session/exchange`, com `view=compact`. A API valida assinatura, uso único, unidade e identidade, define cookie HttpOnly e redireciona apenas para `/ada/compacto`.
5. A conversa usa as APIs e permissões existentes. Só a pergunta do usuário usa o fluxo normal da IA; presença do botão, verificação de sessão e troca de tela não chamam o modelo. O estudo inicial de sessão existente continua com cache e sem geração por modelo.

O JavaScript e a ponte exigem a mesma origem pública do POSSEBON, incluindo protocolo e porta. Não alterar credenciais para instalar. A configuração existente `AdaIntegrationService::adaUrl()` precisa coincidir com o endereço usado no navegador. A instalação não troca a URL configurada nem enfraquece HTTPS/CSP/cookies.

## Navegação e identidade

O botão fica no body, fora do contêiner de páginas AJAX. A conversa permanece montada durante a navegação; em recarga completa, o histórico compacto retoma pelo sessionStorage existente, separado por usuário e unidade. Ao detectar troca de identidade/unidade, remove o iframe anterior. As verificações ocorrem ao abrir, ao voltar para a página, na navegação detectada e a cada 30 segundos enquanto visível. Não há promessa de revogação visual instantânea; a API continua aplicando a autorização em cada consulta e o cache de identidade configurado.

Ao reabrir, a ponte refaz a troca SSO para o usuário/unidade do POSSEBON. O cliente também envia o contexto de usuário/unidade esperado nas requisições da API; se outra aba tiver trocado o cookie, a API recusa a leitura com SESSION_CONTEXT_CHANGED, antes de executar a consulta. O cabeçalho apenas confere o contexto; não concede acesso ou substitui a autorização. A conversa compacta oferece reconexão nessa situação.

O controlador `class` da URL é uma pista de contexto. Não deduz tabela ou ID de parâmetros genéricos. Um formulário pode informar explicitamente o registro:

```js
window.PossebonAssistant?.setContext({module:'Solicitação de compra',table:'TABELA_REAL_CONFIRMADA',recordId:123});
// Ao sair do registro:
window.PossebonAssistant?.setContext(null);
```

Use somente nomes reais já validados. A pista não autoriza o acesso e os dados operacionais são consultados de novo. Mensagens postMessage verificam origem e iframe emissor. Ao detectar o iframe do painel completo, o botão externo fica oculto para evitar duplicação; o painel mantém seu botão próprio. O link ↗ abre o painel em outra aba, com a conversa atual. Erros/expiração mostram reconexão e não apagam histórico. O nome é atualizado pela configuração administrativa.

## Instalação no servidor

Depois de atualizar a IA para esta versão:

```bash
node /opt/ada/current/scripts/deploy/install-global-assistant.mjs /PASTA/DO/POSSEBON check
node /opt/ada/current/scripts/deploy/install-global-assistant.mjs /PASTA/DO/POSSEBON apply
```

O auxiliar `scripts/deploy/enable-global-assistant.sh COMMIT check|apply` faz a descoberta da pasta com SSO em /var/www ou /srv/www, prepara a simulação a partir do commit, chama o atualizador existente da IA e só então instala a ponte. O padrão é check. `POSSEBON_WEB_ROOT` permite apontar a instalação existente quando a descoberta não for inequívoca. Não inicia conexão SSH ou lê senhas.

O modo `bridge` repara somente a ponte quando a IA global já foi publicada: confere a ancestralidade da versão com SSO compacto e compara o JavaScript compilado antes de instalar. Não recompila, migra ou reinicia serviços. A CLI resolve caminhos reais para funcionar também pelo link `/opt/ada/current`. O auxiliar executa o instalador do pacote validado e confere os arquivos/inclusões antes da mensagem final de sucesso.

A ferramenta de reversão fica copiada no próprio backup, fora do pacote temporário. O comando impresso continua funcionando depois que o diretório temporário da instalação é removido.

Permissões finais são aplicadas explicitamente após criar o arquivo temporário: a umask 077 do bootstrap não pode reduzir 0644 da ponte para 0600. Os dois arquivos PHP novos precisam ser legíveis pelo processo PHP; os layouts mantêm seus modos anteriores. Segredos/configuração não são incluídos nem têm permissões alteradas.

Requer Node e PHP CLI. O caminho deve conter `init.php`, `app/custom/AdaIntegrationService.php` e `app/templates/*/libraries_user.html`. Os templates reais analisados carregam esse arquivo tanto no desktop quanto no mobile. A simulação valida sintaxe PHP e compatibilidade do emissor. Se já houver ponte ou inclusão, bloqueia para revisão em vez de sobrepor.

Acrescenta `ada-assistant.php` na raiz e `app/custom/AdaAssistantBridge.php`. Preserva literalmente o conteúdo dos libraries_user.html e acrescenta um script com versão pelo hash. Não altera index.php, engine.php, login, serviços existentes, tabelas, .env, conversas ou dashboards. Arquivos gravados por renomeação; backup com hashes e metadados em `/var/backups/ada/possebon-global-assistant`. Falha restaura os arquivos instalados; não sobrepõe uma alteração concorrente. O comando de reversão é impresso ao concluir e exige que todos os arquivos ainda correspondam à instalação.

Antes de atualizar a IA, o script de entrega simula a instalação com os arquivos do commit exato. Só após testes/build/saúde da IA aplica a ponte no POSSEBON. A pasta do sistema pode ser informada por `POSSEBON_WEB_ROOT`; a descoberta automática só aceita um candidato inequívoco com SSO instalado.

## Persistência no MAD Builder

A inclusão também deve fazer parte das bibliotecas/HTML globais do tema no projeto MAD Builder. Uma exportação que regenere libraries_user.html pode removê-la. Preserve os dois novos arquivos como extensões do projeto e a inclusão abaixo em cada tema usado, uma única vez:

```html
<script defer src="/ada/possebon-assistant.js" data-base="/ada/" data-bridge="ada-assistant.php"></script>
```

O script resolve data-bridge relativo ao documento. Em instalação em subpasta, valide a URL pública da ponte e prefira caminho absoluto correspondente. Não colocar tickets/chaves no HTML. A API da IA e o proxy precisam servir `/ada/` na mesma origem. Esta entrega prepara e testa os arquivos; não confirma alteração do projeto remoto no editor MAD Builder.

## Evidências e limites

Testes de sessão validam redirecionamento compacto, rejeição de destino livre/origem externa e preservação de usuário/unidade. Testes do instalador exercitam simulação, backup, preservação do layout, reversão e bloqueio de alterações posteriores (validação PHP substituída por stub nesses testes). Uma execução PHP 8.3 separada valida nove cenários reais da ponte com sessão/emissor simulados. Navegador local verifica abertura, resposta da API real com dados sintéticos, persistência na navegação/recarga, unidade e ausência de duplicação. Não equivale ao teste final no POSSEBON publicado.
