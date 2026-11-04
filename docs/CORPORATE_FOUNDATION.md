# Base corporativa POSSEBON — revisão 2026-11-01

## Entrega

Estrutura editorial em 12 áreas: empresa/consórcio/empreendimento; contratos e obrigações; planejamento e prazo; execução/produção/RDO; compras e suprimentos; materiais/estoque/patrimônio; financeiro/custos/caixa; pessoas/equipes; SMS; qualidade/documentação; engenharia/comissionamento; sistemas/dicionário de dados.

Cada área tem objetivo, critérios de análise e referências dos documentos efetivamente indexados e autorizados. O método é orientação editorial; trechos são evidências documentais, nunca novos fatos inventados. Uma área sem fonte permanece explicitamente sem documentação. A cobertura não certifica compreensão integral.

## Organização sem chamadas ao modelo

O serviço monta localmente um dossiê extrativo e o cifra em app_setting por usuário e unidade. Revalida identidade de sessão, revisão de permissões, programas, escopo, validade e estado dos documentos/fontes antes de reutilizar o conteúdo. O índice considera até 2.000 documentos autorizados e informa truncamento. Seleciona até dois documentos por área, um trecho de até 900 caracteres por documento. São amostras de navegação; cláusulas e respostas específicas continuam exigindo busca documental.

A revisão e a impressão digital das fontes invalidam o dossiê quando o acervo muda. Não há leitura por modelo durante a montagem. Em cada resposta entram somente as áreas pertinentes, até seis referências de até 450 caracteres. O chat ainda usa tokens; o estudo aprofundado existente permanece opcional, com seu orçamento. Não existe promessa de custo zero de conversa.

O conjunto público existente conserva as datas de observação originais. Esta entrega não declara pesquisa nova em todos os sites ou redes, não importa anexos ausentes e não modifica os pesos do modelo. Os contratos particulares permanecem no banco do usuário; nenhum conteúdo contratual real foi incluído no GitHub.

## Perguntas amplas

“Como está a empresa?” passa a receber contexto estruturado e verificação do mapa operacional, além das ferramentas consultar_base_corporativa e consultar_significado_codigo. O método exige cruzar prazo/produção, custo/caixa, compras/materiais, pessoas, contratos e riscos nas fontes acessíveis. Não conclui saúde financeira pela quantidade de colaboradores nem produtividade pela quantidade de RDO. As consultas e os limites de etapas da IA continuam sendo necessários; a implementação orienta o raciocínio, não garante execução perfeita de qualquer pergunta.

## Aprendizagem de códigos

Um significado é específico de unidade, tabela, campo e código. O dicionário versionado anterior mantém A/D de colaborador.status. O significado real de G não foi comprovado nesta entrega; não foi inventado.

Na tela O que a IA aprendeu, um administrador pode selecionar uma área com documento elegível e homologar uma definição, informando tabela, campo, código, descrição e trecho literal. A API exige que o trecho contenha código e descrição e exista no documento vigente e autorizado. A aprovação humana é registrada com usuário, data, checksum e auditoria. Não é uma inferência automática de que uma citação prova uma regra: o administrador é responsável por homologar a relação correta.

As definições são cifradas e aplicadas aos resultados de consultas operacionais. O retorno inclui codeDefinitions com código original, descrição, evidência e estado de validação. Definições deixam de ser usadas se a fonte mudar de checksum, perder validade, ficar inativa ou não puder ser lida pelo solicitante. Conversas e hipóteses não viram fatos oficiais automaticamente. O estudo corporativo já existente continua extraindo conhecimento com evidência sob controle de consumo.

## Interfaces e implantação

- GET /corporate-base?area=contratos: índice ou dossiê da área autorizado.
- GET /business-dictionary: definições documentais válidas para a sessão.
- PUT /admin/business-dictionary: aprovação administrativa com evidência.
- O que a IA aprendeu: cobertura, áreas, referências e homologação administrativa.

Não há nova migração: usa app_setting e as estruturas documentais existentes. A atualização SSH preserva configurações, conversas, dashboards e fatos. Produção, códigos reais e registros reais precisam ser validados no servidor após instalar o commit.

## Validação desta entrega

157 testes em 31 arquivos aprovados, lint, tipos, compilação web/API/worker e verificação de segredos. Depois do ajuste visual dos formulários, lint, tipos e compilação web repetidos com sucesso. No navegador local foram verificados índice das 12 áreas, referências e homologação do código fictício X com documento sintético. Não houve conexão ao servidor real nem homologação do código G de produção.
