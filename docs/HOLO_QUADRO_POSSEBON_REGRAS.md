# HOLO / POSSEBON — quadro de inteligência e consulta segura

## Objetivo aprovado em 21/10/2026

Transformar a interface atual em um **ambiente empresarial de consultas visuais**,
mantendo a identidade POSSEBON, nome configurável e dados operacionais **sempre consultados na origem**.

### Entregue nesta primeira evolução do HOLO Companion local

- Tela inicial solicita autenticação POSSEBON antes das consultas.
- O mapa/gestos deixa de ser a página principal e só aparece com permissão
  `can_manage_ai=true` emitida pelo backend autenticado (falha fechado).
- Quadro infinito com painéis móveis, zoom, exportação .xlsx, .csv e impressão/salvar PDF.
- Dados estruturados de colaboradores ativos vindos da API de leitura aparecem com fonte,
  filtros e data; explicações não verificadas aparecem como texto com aviso, **nunca como gráfico real**.
- Painel lateral mostra categorias encontradas no índice autorizado do Brain.
- Respostas completas passam para o quadro; chat fica compacto, usado para comandos e voz.
- Chamadas de dados do serviço local retornam HTTP 401 sem sessão POSSEBON.
- Memória de conversa separada por identificador de usuário e unidade em arquivos locais novos;
  histórico legado `conversas.json` foi mantido intacto, sem ser apresentado a outros usuários.
- Perguntas operacionais sem API autorizada retornam "consulta ainda não integrada";
  o Llama não pode inventar lista nominal, pedidos ou contagens para esses casos.
- Nome do assistente é editável pelo administrador **neste navegador** quando a API entrega
  `can_manage_ai`; uma configuração compartilhada ainda exige persistência no backend.

**Atenção:** a instância atual roda exclusivamente em `127.0.0.1:4891`,
com **uma sessão POSSEBON por processo**. Ainda não é serviço multiusuário.
O overlay de login não substitui proteção de API: por isso o backend local bloqueia endpoints
sem sessão. Não compartilhar a mesma instância/processo entre funcionários até implantar
sessões independentes, autenticação central e auditoria.

### APIs que precisam existir no backend POSSEBON Web VIVO, MAD Builder/Adianti

O repositório `possebon_web` do GitHub não representa obrigatoriamente o backend vivo.
Usar o código e o schema reais, permissões e regras curadas do POSSEBON Brain antes de criar rotas.

1. **Identidade / permissões**: `POST /api/app/holo/autenticar` já existe; acrescentar, após
   conferência de permissões efetivas do usuário, campo `can_manage_ai: boolean`
   e lista de capacidades aprovadas. Não confiar em papéis fornecidos pelo navegador.
   Restringir o estudo integral de código, regras e esquema aos administradores autorizados.
2. **Listagem nominal de equipe**: nova rota GET sob `/api/app/holo/operacional/`
   para resolver a referência "TI" em uma equipe real e retornar nomes, cargos e vínculos,
   somente nas equipes/unidades permitidas ao solicitante. Se "TI" for ambíguo,
   pedir seleção; não inferir um nome de uma amostra.
3. **Acesso ao refeitório**: rota GET para a data/unidade autorizadas, com contagem
   explícita de **pessoas distintas** e **eventos de acesso**, indicando filtros.
   O significado de `tipo='R'` é uma hipótese relatada pelo usuário: confirmar
   no código do ListView/formulário e na tabela real antes de promover como regra.
4. **Compras**: rota GET com scopo do usuário (solicitante/comprador/gestor) para
   Solicitações de Compras, itens, status, datas, IDs, fornecedor e evolução.
   No projeto POSSEBON, SC usa `procurement` e a identidade `ID_SEQ_MAPA`;
   conferir vínculo com OC e tabelas no backend atual antes do dashboard.
5. **Solicitações de contratação**: identificar o cadastro e as regras reais antes
   de criar consulta. O banco/filtro de contratação não foi confirmado.
6. **Rede neural e administração**: endpoints autenticados para estatísticas e fontes
   do Brain; não disponibilizar código/permite/estrutura sigilosa a todos os usuários.

Cada rota deve confirmar servidor-side: token, identidade, unidade, grupos,
escopo hierárquico, limites/paginação, status de dados, autorização para cada campo,
rastreabilidade e logs. Por padrão **somente leitura**.

### Arquitetura alvo antes da liberação para toda a empresa

- Sessão independente por usuário (não variável singleton global);
  backend central HTTPS, armazenamento seguro de sessão e auditoria por consulta.
- Estudo inicial administrativo: catálogo de tabelas, FKs, índices, modelos, código de
  ListView/Form, regras curadas, processos e permissões, mantendo proveniência.
- Inferência semântica em três estágios: **descobrir hipótese > validar evidência com
  esquema+código+amostra autorizada > administrador aprovar conceito**. Exemplo:
  "refeitório" pode mapear a `acesso.tipo='R'` apenas após validação.
- Consultas reais não usam SQL livre gerado pelo Llama. Um planejador seleciona
  capacidades aprovadas; API aplica filtros de escopo; resultado estruturado traz
  `fonte, data_referencia, filtros, colunas, linhas, agregacoes, unidade`.
- Renderer suporta KPI, tabela nominal, linha temporal, gráfico de barras, fluxo,
  cronograma e comparação, conforme dados retornados e com fontes visíveis.
- Histórico persistente por usuário/empresa, com políticas de retenção e isolamento.
- Controle visual de nome e marca compartilhado persistido no POSSEBON por admin.

### Validação obrigatória antes de uso amplo

1. Login de colaborador: negar acesso a dados da unidade de outro usuário.
2. Testar gerente e trabalhador comum; mesmo texto deve retornar apenas escopo permitido.
3. Logout/troca de unidade limpa o quadro e não permite consultar memória alheia.
4. Refeitório: conferir contagem distinta de pessoas versus acessos repetidos.
5. Equipe TI: nomes reais devem coincidir com consulta parametrizada do POSSEBON.
6. Solicitações de compras e RH: retornar só as do usuário/equipe autorizada.
7. Llama não gera nomes/números onde a API não retorna dados.
8. Exportações XLSX/PDF preservam cabeçalho, fontes, filtros e restrições de acesso.
9. Verificar desempenho no modelo `llama3.2:3b` com `num_ctx=2048`, sem contexto excessivo.

### Implantação da primeira evolução

Esta ramificação é proposta para avaliação em PR, **não foi instalada** na máquina Windows
nem publicada no POSSEBON Web. Após testes e revisão, atualizar o diretório local
`D:\Usuarios\pedro\holo-gestures-feature-holo-assistente-local-brain (1)\holo-gestures-feature-holo-assistente-local-brain`
com arquivos da mesma revisão, mantendo backup da pasta e `D:\HOLO\Memoria-HOLO`.
Não substituir módulos isolados de revisões diferentes.
