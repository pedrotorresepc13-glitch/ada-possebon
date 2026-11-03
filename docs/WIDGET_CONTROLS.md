# Correção isolada da conversa global

O botão usa a sessão autenticada do POSSEBON Web, com o programa AdaEmbedView ou AdaAdministracao. Não exige perfil administrativo. Uma sessão válida da IA só é reaproveitada se usuário e unidade coincidirem; caso contrário, o widget solicita um ticket ao servidor PHP e troca-o pelo cookie existente da API. Não usa identidade enviada pelo navegador nem coloca tickets em URLs.

O cabeçalho oferece notificações, ampliar/reduzir e abrir o painel completo na mesma conversa. O contador consulta a central existente, sem chamadas de IA. Minimizar preserva o iframe e a conversa. O iframe permite microfone e áudio; o recurso de voz continua sendo o da versão já instalada.

## Instalação

`scripts/deploy/update-widget-controls.sh COMMIT` instala exclusivamente `possebon-assistant-global.js` na raiz publicada e substitui a referência anterior nos arquivos `libraries_user.html`. Não usa `update.sh`; não compila nem seleciona release, não reinicia serviços, não executa migrações e não altera PHP, rotas, configuração ou dados.

O pacote permanece fora da pasta pública. O instalador simula primeiro, preserva bibliotecas, proprietário e permissões, grava backup com hashes e imprime o comando de reversão. Layout ambíguo, symlinks e arquivo externo de mesmo nome bloqueiam a instalação. A reversão não sobrescreve alterações posteriores.

O diagnóstico final lê o ambiente do processo da API e verifica a identidade conhecida 230 na unidade 3. Mostra somente endereço sem parâmetros, resultado HTTP e confirmação booleana; não divulga credenciais ou payload. Uma resposta 404 impede a validação de novas sessões, mesmo que uma sessão antiga do Pedro funcione. Esse diagnóstico não altera a configuração.

## Validação realizada

- Navegador com API real e PGlite isolado: primeiro acesso sem cookie da IA por usuário não administrador, resposta ao pedido “ajuda”, contador e abertura da central de notificações, ampliação, continuidade ao minimizar e remoção após perda de acesso.
- Três testes do instalador: preservação de PHP/rotas/versão com voz, simulação e reversão, recusa de layouts ambíguos, arquivo externo e alteração posterior.
- Nove cenários PHP da ponte existente, incluindo usuário autorizado sem programa de administração e negativas de autorização/origem/CSRF.

O teste isolado não confirma o endpoint de identidade da produção nem áudio real. Validar primeiro acesso de outro usuário autorizado na instalação real após aplicar. Exports futuros do MAD Builder devem manter a nova referência no projeto.
