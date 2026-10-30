# IA POSSEBON — cérebro corporativo e dashboards (30/10/2026)

## O que está implementado e testável
- Identidade real do POSSEBON Web no servidor e ACL por programa/unidade.
- Ingestão local idempotente do inventário de 216 modelos e dos anexos EPC13, sem conteúdo contratual no GitHub.
- Tratamento de surrogates Unicode isolados antes do PostgreSQL JSONB, inclusive nas bordas dos fragmentos.
- Migração `0004_brain_graph`: rede persistente de referências de modelos, tabelas, campos, telas, áreas, módulos e documentos/partes, com fonte e ACL. A ferramenta `consultar_cerebro` acessa a rede, com autorização por sessão.
- Pesquisa full-text nos documentos indexados com citação/proveniência. Não é treinamento dos pesos da rede neural nem indexação vetorial.
- Telas/dashboards salvos, revisões, filtros, gráficos e consulta de métricas pelo backend, sem rodar o modelo de IA. Atualização automática a cada 30 segundos quando a aba estiver visível e ao voltar para a tela. O intervalo evita a dependência de eventos de produção ainda não publicados.
- Primeira métrica **real catalogada**: `possebon.colaborador.cadastros` (registros em `colaborador` não excluídos por **data de cadastro**, opcionalmente por equipe, sempre filtrados por `unit_id`). Não é métrica de presença, ativo ou efetivo atual.

## Dependência para ver dados operacionais reais
A IA não recebe credenciais do banco do POSSEBON automaticamente e não adivinha joins ou regras de negócio. O administrador precisa fornecer uma conexão PostgreSQL **somente leitura** à fonte real por `POSSEBON_READONLY_DATABASE_URL` em `.env`, sem commit e sem mostrar a senha em logs.

O conector `possebon.pg_readonly` inicia com status `nao_configurado` (ou `configurado_nao_validado` quando há URL). A interface de administração oferece **Testar conexão**: o teste exige `SELECT` real e confirma as colunas de `public.colaborador` e `public.equipe` e consulta limitada por unidade. Somente ao passar é ativado, evitando números fictícios. Se a conexão não existir, os dashboards retornam "Fonte indisponível".

Exemplo de configuração privada, apenas como modelo de formato — **não colar credenciais no GitHub ou no chat**:

```dotenv
POSSEBON_READONLY_DATABASE_URL=postgresql://USUARIO_LEITURA:SENHA@127.0.0.1:15432/BANCO
```

Se o PostgreSQL não for diretamente acessível no Windows, usar um túnel SSH autorizado para o servidor. `127.0.0.1` no exemplo é o lado local de um túnel; em endereços remotos diretos a conexão exige TLS.

A conta PostgreSQL deve ter apenas `CONNECT`, `USAGE` no schema e `SELECT` nas tabelas/VIEWs aprovadas; não utilizar `postgres`, superusuário ou credenciais do aplicativo Web. O código abre transações `READ ONLY` com timeout e só executa fórmulas fixas de um catálogo revisado, nunca SQL gerado livremente pelo modelo.

## Como concluir as importações já iniciadas
Com API e worker **desligados** e backup do diretório PGlite:
1. `npm run ci` no código atualizado.
2. `npm run brain:import-inventory -- "CAMINHO_INVENTARIO.json"` para gerar o grafo de arquitetura (4 documentos permanecem idempotentes).
3. `npm run knowledge:import-epc13 -- "CAMINHO_CORPUS.jsonl.gz" 230` para retomar as partes que faltaram e gerar o grafo contratual.
4. `npm run dev:api` e abrir `http://127.0.0.1:4800/ada/`; SSO real continua exigido, sem habilitar login de desenvolvimento.

**Não** executar `git reset --hard`, `git stash pop` ou apagar `.data/pglite_ada_novo_20261029` para atualizar. O backup de conversas, `.env` e chaves devem ser preservados.

## Critérios de qualidade e limitações
- A execução de testes CI e a importação local não substituem a validação real no ambiente POSSEBON.
- O inventário representa a estrutura fotografada em 28/10/2026, não as mudanças posteriores nem as linhas operacionais.
- Campos `*_id` listados no inventário NÃO são automaticamente considerados FKs confirmadas.
- O grafo não interpreta sozinho todas as regras contratuais; continua sendo necessária recuperação de trechos e raciocínio contextual do modelo.
- Embeddings e pesquisa vetorial sobre conteúdo contratual não estão habilitados: enviar textos sigilosos a serviços externos exigiria decisão específica de proteção de dados.
- A atualização de 30 segundos é polling com revalidação de acesso, não notificação instantânea do PostgreSQL. Futuramente poderá usar eventos/outbox quando a origem fornecer esse recurso.
- As regras de presença, treinamentos, RDO e indicadores financeiros exigem métricas/joins validados individualmente. Jamais afirmar "cobertura integral" apenas com importação documental.
