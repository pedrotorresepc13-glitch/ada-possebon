# HOLO Enterprise — Instalação local

## Implementado na branch de testes
Esta versão acrescenta ao HOLO de gestos: serviço local Node.js na porta 4891; janela de conversa no canto direito; texto, voz de resposta e reconhecimento de voz quando suportado pelo navegador; IA local Ollama ou API externa; histórico e notas locais; conector opcional de leitura ao Brain; visualizador de arquivos de uma pasta aprovada, com janela arrastável.

Ela NÃO altera o POSSEBON Web, My Import, filas, banco de dados nem a branch principal. As conexões reais não foram validadas no ambiente vivo, e a webcam/voz ainda precisam de testes manuais.

## Windows: iniciar com um clique
1. Baixe o ZIP da branch feature/holo-assistente-local-brain e extraia.
2. Execute o arquivo Iniciar-HOLO.cmd, depois de conferir que o script veio do repositório confiável.
3. Quando necessário, ele instala Node.js LTS e Ollama pelo winget, baixa o modelo llama3.2:3b (aproximadamente 2 GB de modelo) e abre http://127.0.0.1:4891/
4. Clique no botão HOLO Assistente, no canto direito. Use o microfone se o navegador permitir, ou digite.
5. Para um modelo menor, no PowerShell execute: .\tools\Instalar-HOLO.ps1 -Modelo llama3.2:1b

O script precisa de internet e espaço em disco. Se existir um servidor de testes HOLO na porta 4891, encerre apenas esse servidor antes. Não encerre My Import ou POSSEBON.

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
- Os dados ficam em %USERPROFILE%\.holo-enterprise\conversas.json: até 36 mensagens e 100 notas.
- Dizer "HOLO, lembre que..." grava uma anotação marcada PENDENTE_VALIDACAO; não altera regras oficiais no Brain.
- O reconhecimento de fala do navegador pode enviar áudio ao fornecedor do navegador. Whisper/Piper completamente offline ainda não foram implementados.

## Limitações de segurança e próximos passos
Este serviço é MONOUSUÁRIO e acessível apenas em loopback 127.0.0.1. Não o exponha pela internet ou num servidor compartilhado antes de adicionar autenticação por pessoa, unidade e permissões de documentos. A Vercel continua sendo uma demonstração estática sem processamento local da IA.

Falta validar a rota viva do Brain e token apropriado, integrar arquivos autorizados do servidor POSSEBON, testar webcam e microfone reais, e expandir o gesto para manipular documentos. Os testes automatizados de sintaxe e HTTP não substituem essa validação.
