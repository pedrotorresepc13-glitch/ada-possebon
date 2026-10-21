# HOLO Enterprise — Instalação local

## Implementado na branch de testes
Esta versão acrescenta ao HOLO de gestos: serviço local Node.js na porta 4891; janela de conversa no canto direito; texto, voz de resposta e reconhecimento de voz quando suportado pelo navegador; IA local Ollama ou API externa; histórico e notas locais; conector opcional de leitura ao Brain; visualizador de arquivos de uma pasta aprovada, com janela arrastável.

Ela NÃO altera o POSSEBON Web, My Import, filas, banco de dados nem a branch principal. As conexões reais não foram validadas no ambiente vivo, e a webcam/voz ainda precisam de testes manuais.

## Windows: iniciar com um clique
1. Baixe o ZIP da branch feature/holo-assistente-local-brain e extraia.
2. Execute o arquivo Iniciar-HOLO.cmd, depois de conferir que o script veio do repositório confiável.
3. O script exige que o disco `D:` esteja acessível antes de baixar qualquer modelo. Cria `D:\HOLO\Modelos-Ollama` e `D:\HOLO\Memoria-HOLO`, configura `OLLAMA_MODELS` e `HOLO_LOCAL_DATA_DIR` para o seu usuário e tenta instalar o Ollama em `D:\HOLO\Aplicativos\Ollama` se ele não existir. Node.js LTS pode ser instalado no local padrão do Windows. O instalador baixa o modelo `llama3.2:3b` (aproximadamente 2 GB) e abre http://127.0.0.1:4891/.
4. Clique no botão HOLO Assistente, no canto direito. Use o microfone se o navegador permitir, ou digite.
5. Para um modelo menor, no PowerShell execute: .\tools\Instalar-HOLO.ps1 -Modelo llama3.2:1b

O script precisa de internet e espaço no disco D:. **O local padrão dos modelos e da memória é D:**, mas bibliotecas do Windows, caches, componentes já instalados e Node.js podem continuar ocupando algum espaço no C:. O projeto deve ser extraído para `D:\HOLO\App` se você quiser os próprios arquivos do HOLO no D:. Não encerre My Import ou POSSEBON. Se o Ollama já estiver ativo com o destino antigo, o script pedirá autorização para reiniciar **somente o Ollama**.

### Você já instalou usando a versão antiga?

1. Espere a instalação em andamento terminar ou interrompa apenas o download da IA, se desejar. **Uma alteração no GitHub não atualiza automaticamente um instalador que já está aberto.**
2. Baixe novamente o ZIP da branch atual e extraia-o no D: (ex.: `D:\HOLO\App`).
3. Execute `Iniciar-HOLO.cmd` da nova pasta. Ele copia os modelos já baixados de `%USERPROFILE%\.ollama\models` para `D:\HOLO\Modelos-Ollama` quando o destino estiver vazio, mantendo a pasta original intacta. Se o D: já contiver modelos, não mistura bibliotecas automaticamente.
4. A memória anterior em `%USERPROFILE%\.holo-enterprise\conversas.json` também será copiada para `D:\HOLO\Memoria-HOLO\conversas.json`, desde que o novo destino não exista.
5. **Não apague nada do C:** antes de confirmar que o Ollama lista seus modelos e o HOLO responde normalmente a partir do D:.

Para verificar o destino no PowerShell, execute `[Environment]::GetEnvironmentVariable('OLLAMA_MODELS','User')`. O resultado esperado é `D:\HOLO\Modelos-Ollama`. Se alterou o destino com o Ollama já aberto, é necessário reiniciá-lo para a mudança valer.

## Conectar ao POSSEBON Web pela nova API HOLO (etapa de testes)

**Pré-requisito:** o administrador deve ter publicado `HoloKnowledgeApiTrait.php`, as 3 rotas
`/api/app/holo/*` e a inclusão correspondente no `ApiAppController` do MAD Builder vivo.
A integração usa credenciais de usuário diretamente na interface local, **não** deve receber
tokens ou senhas em chats, GitHub ou arquivos de configuração.

1. O POSSEBON Web deve responder por HTTPS com certificado válido. O endereço padrão do conector
   é `https://app.possebon.com.br:19302`. Se o endereço HTTPS real for diferente, configure
   a variável de ambiente `HOLO_POSSEBON_URL` **antes de iniciar** o serviço HOLO. Não é aceito HTTP
   para autenticação por senha, nem certificados ignorados.
2. No HOLO local em `http://127.0.0.1:4891/`, clique **Conectar POSSEBON**. Informe seu login e senha
   do POSSEBON Web diretamente no formulário, selecione a unidade autorizada e conecte. Se a conta
   exigir 2FA, a API recusa a primeira versão até existir o fluxo de dois fatores.
3. No primeiro acesso por usuário/unidade, o estudo inicia automaticamente. A HOLO consulta
   `brain/status` e `brain/itens`, por páginas de até 30 itens e pequenos intervalos.
   **Não chama sync, commit, feedback nem modifica o banco.**
4. A tela informa progresso e o índice concluído fica em
   `D:\HOLO\Memoria-HOLO\conhecimento-possebon\user-<ID>-unit-<ID>.jsonl`,
   se `HOLO_LOCAL_DATA_DIR` estiver configurada conforme o instalador. O cache é separado
   por usuário/unidade. Uma nova autenticação é necessária ao reiniciar o Companion.
   O token da sessão (30 minutos) só fica na memória do processo e não no disco.
5. O botão **Estudar / atualizar Brain** refaz a leitura quando necessário. O índice anterior
   permanece válido caso a nova tentativa falhe. A assistente utiliza trechos relevantes
   da base local e indica quando não há fonte.
6. O arquivo JSONL local contém metadados/código do Brain **em texto legível**: proteja o
   acesso NTFS à pasta D:. O conteúdo pode ser sensível; não compartilhe o cache.
   O estudo não acessa automaticamente dados operacionais ao vivo ou documentos fora do Brain.

Para verificar a publicação sem expor credenciais:
```powershell
try {
  Invoke-WebRequest -Uri "https://app.possebon.com.br:19302/api/app/holo/brain/status" -UseBasicParsing
} catch {
  Write-Host "HTTP:" ([int]$_.Exception.Response.StatusCode)
  Write-Host "Erro:" $_.Exception.Message
}
```
O resultado esperado, sem um token, é HTTP 401. Se falhar o HTTPS, confirme o endereço
e o certificado antes de tentar login. Nenhum teste simulado certifica a conexão real.

## Conectar ao Brain (opcional)
O POSSEBON Brain já possui método contextoPossebonBrain, com autenticação Bearer técnica ligada a usuário e unidade. O endereço e o método HTTP precisam ser confirmados na API do ambiente vivo.

Variáveis do processo local:
- HOLO_BRAIN_CONTEXT_URL: endereço HTTPS completo e confirmado da rota de contexto.
- HOLO_BRAIN_TOKEN: credencial técnica autorizada em escopo somente de leitura; nunca publique esse valor em GitHub, navegador ou Vercel.
- HOLO_AI_PROVIDER: local (padrão) ou api.
- HOLO_LOCAL_MODEL: llama3.2:3b (padrão).
- Para API externa: HOLO_API_URL, HOLO_API_MODEL, HOLO_API_KEY. Se Brain estiver conectado, a transmissão externa de seu contexto exige autorização explícita HOLO_PERMITIR_BRAIN_API_EXTERNA=1.

Depois de configurar as variáveis, execute o Companion no mesmo ambiente: node services/holo-companion.mjs

Esta integração apenas consulta o catálogo de conhecimento Brain. Não lê todos os dados operacionais e não acessa automaticamente arquivos existentes no POSSEBON. Em particular, o backend vivo do POSSEBON é o MAD Builder; o repositório possebon_web no GitHub pode estar desatualizado.

## Documentos e memória
- HOLO_DOCUMENTOS_DIR: caminho de uma pasta LOCAL expressamente autorizada. Somente arquivos regulares na raiz dessa pasta, tipos txt, md, csv, json, pdf, png e jpg, até 12 MB cada. A janela flutuante pode ser arrastada por mouse ou toque; a movimentação por gestos ainda não está integrada.
- Os dados ficam por padrão em `D:\HOLO\Memoria-HOLO\conversas.json` (variável `HOLO_LOCAL_DATA_DIR`): até 36 mensagens e 100 notas.
- Dizer "HOLO, lembre que..." grava uma anotação marcada PENDENTE_VALIDACAO; não altera regras oficiais no Brain.
- O reconhecimento de fala do navegador pode enviar áudio ao fornecedor do navegador. Whisper/Piper completamente offline ainda não foram implementados.

## Limitações de segurança e próximos passos
Este serviço é MONOUSUÁRIO e acessível apenas em loopback 127.0.0.1. Não o exponha pela internet ou num servidor compartilhado antes de adicionar autenticação por pessoa, unidade e permissões de documentos. A Vercel continua sendo uma demonstração estática sem processamento local da IA.

Falta validar a rota viva do Brain e token apropriado, integrar arquivos autorizados do servidor POSSEBON, testar webcam e microfone reais, e expandir o gesto para manipular documentos. Os testes automatizados de sintaxe e HTTP não substituem essa validação.
