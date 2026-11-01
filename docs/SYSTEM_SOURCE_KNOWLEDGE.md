# Conhecimento do sistema completo — 2026-11-01

## Estrutura dinâmica, sem lista fechada

SystemKnowledgeService cruza o esquema PostgreSQL acessível, referências do inventário, documentos autorizados, dicionário de códigos e histórico de consultas bem-sucedidas. O catálogo não depende da lista de módulos dos roteiros editoriais. Inclui tabelas novas, campos, FKs verificadas, modelos, telas, extensões e fontes. Uma tabela não equivale a um módulo; programa não equivale a tabela. Referências antigas do grafo mantêm sua revisão e não comprovam integração atual.

Toda pergunta de sessão POSSEBON recebe uma seleção compacta da estrutura pertinente, em vez de depender de uma expressão com nomes conhecidos previamente. A ferramenta conhecer_sistema pesquisa o catálogo paginado ou abre o dossiê da tabela. Para RDO, SC/OC, AUDCOMP/Audicomp, ronda e SMS há roteiros adicionais, identificados como orientação editorial, sem inventar procedimentos, escalas ou expansão de siglas.

Uma leitura real registra somente tabelas, horário e escopo, em cache cifrado por usuário/unidade/versão de permissões. Não armazena linhas, SQL ou valores de negócio. Consulta com erro não produz marca de sucesso. Mudança de permissões invalida a cobertura. O histórico confirma aquela leitura naquele instante; não garante que a fonte continue disponível.

## Pacote privado extraído do POSSEBON Web

O extrator scripts/knowledge/extract-system-source.ts lê apenas arquivos PHP de app/model, app/control, app/custom e app/service da cópia indicada pelo operador. Não executa PHP, não lê .env, não copia bancos, anexos, credenciais ou corpos completos de métodos. Exporta modelos/tabelas/campos, telas/títulos, vínculo de activeRecord, enums literais associados ao modelo primário, opções de interface ainda sem vínculo confirmado, valores iniciais discriminadores, consultas derivadas com aliases/tabelas candidatas e nomes de métodos de extensões.

As expressões e concatenações PHP não são avaliadas. Comentários são descartados antes da extração de modelos/telas. Campos sensíveis e tabelas técnicas protegidas são omitidos. Modelos DBQuery são descritos como consultas derivadas, sem converter suas tabelas candidatas em FKs ou fórmulas homologadas. Vínculos de formulário não autorizam executar métodos nem comprovam rotas publicadas.

O pacote deve permanecer privado, fora do GitHub. O operador entrega o .json.gz ao servidor com SHA-256 conferido. A CLI import-system-source.mjs revalida administração POSSEBON na unidade, indexa documentos restritos, sincroniza o grafo e importa os códigos comprovados. Serviços não precisam ser parados para a importação no PostgreSQL; a implantação do código continua usando o atualizador com backup. Não há nova migração.

Essas fontes recebem skip_ai_study=true: já são extração estruturada local e não devem consumir os lotes de estudo profundo nem substituir os trechos institucionais da preparação inicial. Permanecem pesquisáveis pelo chat e pelo inventário. Conversar com o modelo continua consumindo tokens; organizar/indexar esse pacote não usa chamadas ao modelo.

## Códigos e divergências

Cada código pertence a tabela/campo/unidade, com documento e checksum. A importação prioriza o formulário principal com nome ModeloForm; na ausência, usa formulários consistentes, depois definições consistentes das demais telas. Divergência sem referência canônica consistente não vira definição automática. As divergências são relatadas para revisão. Isso não corrige o POSSEBON Web nem certifica regras que o extrator não analisou.

Definições manuais já aprovadas são preservadas. Definições de pacote anterior são substituídas pela revisão importada; documentos retirados ficam rejeitados para recuperação, sem exclusão do histórico. Alteração, pausa, validade ou perda de acesso à fonte invalida o uso do significado. Uma cópia local do código pode diferir do servidor: a origem e a revisão precisam ser consideradas.

## Interface e validação

GET /system-knowledge pesquisa tabelas e referências em páginas. GET /system-knowledge/module?table=... retorna estrutura, fontes, códigos, telas vinculadas e roteiro. A tela O que a IA aprendeu mostra cobertura e pesquisa por qualquer módulo, com campos e valores iniciais declarados.

Os testes devem cobrir módulos não cadastrados, paginação além do corte inicial, isolamento, registro somente após leitura real, falha de fonte, contexto automático no chat, extração de literais sem execução, comentários e expressões ignorados, prioridade de formulário em divergência, indexação idempotente, código aplicado à consulta, reconhecimento de RDO pelo formulário, revogação de fonte e ausência de chamadas de estudo para o pacote.

Limites: conhecer a estrutura não significa conhecer todas as regras ou todos os dados atuais. O esquema usa cache de até 60 segundos; o grafo depende da revisão importada. O catálogo de referências limita a 10.000 nós e informa truncamento. O inventário não remove proteções de acesso. A execução de perguntas, cálculos e vínculos reais ainda precisa de validação no servidor.

## Evidência de validação da entrega

A suíte completa passou com 162 testes em 33 arquivos, incluindo APIs, importação, escopos, retomada e fonte documental. A seleção por tela/área e a interface foram verificadas em prévia isolada; após o ajuste final do vínculo de área, lint, tipos, testes específicos e compilação foram repetidos. O pacote privado completo também foi importado em banco isolado, sem chamada ao modelo. Não houve acesso SSH ou alteração de produção durante essa validação. O conteúdo desse pacote não é parte do repositório.
