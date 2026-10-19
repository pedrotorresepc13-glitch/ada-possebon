# HOLO Enterprise — protótipo empresarial (pt-BR)

> **Novo: Companion local e assistente por voz (branch em testes)** — consulte [instalação no Windows e limites de segurança](docs/INSTALACAO-HOLO-LOCAL.md). Esse serviço separado pode consultar o Brain se configurado, mas não é conexão real comprovada e não altera o POSSEBON Web.


Este fork mantém **intacto o HOLO Gestures original** em `holo.html` e acrescenta um protótipo independente em `index.html`. É uma prova de conceito, **não um ERP pronto nem uma integração ativa com a POSSEBON**.

## O que já existe neste protótipo
- Interface em português do Brasil, objetos distribuídos em planos 3D e mapa de áreas em Three.js, com navegação por mouse. Um **Modo imersivo** oculta os painéis laterais para liberar a área espacial; a câmera opcional funciona como pano de fundo escurecido.
- Gestos com MediaPipe local (branch de validação): pinça para selecionar e arrastar áreas, movimento no espaço vazio para girar o mapa, duas pinças para aproximar/afastar e girar, e sinal de paz para restaurar. Exigem webcam, desempenho e permissões do navegador; validação manual com câmera ainda pendente.
- Comandos de voz em português **quando o navegador suporta reconhecimento**; saída falada optativa.
- Apresentação em tela cheia e indicadores **100% inventados**.
- Criação de espaço empresarial local vazio (somente `localStorage` deste navegador; sem sincronização entre usuários).
- Seleção de provedor de IA: demonstração / modelo aberto local / API externa.
- Serviço local opcional com **Ollama** ou API OpenAI-compatível, sem colocar credenciais no frontend.

## Testar a interface (Windows, macOS ou Linux)

Na pasta do fork, iniciar um servidor estático:

```bash
python -m http.server 4891 --bind 127.0.0.1
```

Abrir `http://localhost:4891/`. Com isso a visualização 3D funciona sem Python persistente da aplicação original. Para testar o HOLO original, continue usando `python server.py` e `http://localhost:4890`.

## Testar modelo de IA gratuito em seu computador

Instalar e executar Ollama, obter um modelo compatível com o computador, por exemplo:

```bash
ollama pull llama3.2
ollama serve
```

Em um segundo terminal na pasta do repositório:

```bash
node services/assistant-server.mjs
```

Na tela, abrir **Motor de IA** e selecionar **Modelo aberto / local**. A ponte responde na porta 4892 apenas para a página servida em localhost:4891. Os modelos dependem de memória e aceleração adequadas; a disponibilidade não é garantida.

## Testar API externa opcional

Definir `HOLO_API_KEY` em uma variável de ambiente **somente no servidor**, podendo configurar também `HOLO_API_MODEL` e `HOLO_API_URL` (endpoint HTTPS OpenAI-compatível), iniciar a ponte e selecionar **API de IA externa**. Não publicar o serviço de desenvolvimento na internet. A API pode enviar o texto digitado ao fornecedor configurado, portanto evite informações empresariais confidenciais nesta etapa.

## Publicação Vercel

O repositório inclui `vercel.json` e uma página estática pronta para ser importada na Vercel com Framework Preset **Other**, diretório raiz `./`, sem Build Command. O site funciona como **demonstração**. A Vercel não hospeda o processo Python local nem o servidor persistente de IA desta prova de conceito. Modelos locais não são acessíveis pela URL pública sem uma ponte própria segura com autenticação.

**Não publique conexões de banco de dados ou tokens diretamente no JavaScript do navegador.**

## Próximas fases (ainda não implementadas)

1. Autenticação e isolamento multiempresa/multiunidade.
2. Banco de dados persistente e permissões de leitura por função.
3. Catálogo de conectores com backend seguro: MySQL, PostgreSQL, SQL Server, Firebase/Firestore e REST.
4. Camada semântica por empresa, descoberta do esquema autorizada e catálogo de indicadores.
5. Indexação incremental de documentação, eventos e regras; agendador de atualização sem varrer todos os registros repetidamente.
6. Assistente com ferramentas autorizadas e fontes auditáveis, histórico, aprovação de ações e modo de reunião com ocultação de informações sensíveis.
7. Infraestrutura de IA remota isolada para uso web e desktop híbrido.

## Regras arquiteturais

- **Nada de dados reais sem autorização explícita e permissão por empresa e unidade.**
- `Empresa`, `Unidade`, `Fonte`, `Entidade`, `Campo`, `Permissão`, `Consulta` e `Evidência` são conceitos canônicos que deverão orientar qualquer conector.
- Conhecimento da estrutura e políticas pode ficar indexado; consultas devem buscar dados atualizados no sistema de origem quando necessário.
- Serviços corporativos nunca devem permitir execução de SQL arbitrário gerado por IA.
- A assistente não pode alegar estudar continuamente dados reais até que fontes, autorização, agenda e trilha de auditoria estejam em operação.
- Mantenha licenças e atribuições do repositório HOLO original (`LICENSE`) e de seus componentes de terceiros.

## Privacidade e voz

O rastreamento de mãos processa imagens no navegador, mas o **reconhecimento de voz pode usar um serviço do fornecedor do navegador**. Não presumir transcrição offline. Esta demonstração não armazena vídeo e não transfere frames ao serviço de IA.
