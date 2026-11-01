# Preparação e acesso operacional — revisão 3

Objetivo: preparar uma visão inicial verificável antes de liberar o dashboard, dar visibilidade ao progresso e ao consumo, e ampliar as consultas sem remover a autorização por unidade.

## Entregas e critérios

1. Consultas: tabelas sem unit_id podem iniciar leitura quando têm um único caminho de até três FKs de saída para uma tabela com unit_id. Dois caminhos ou nenhum caminho produzem diagnóstico de mapeamento obrigatório. Campos sensíveis continuam omitidos. Testes devem impedir consulta entre unidades, caminhos inventados e seleção ambígua.
2. Conector: validar conexão de negócio sem exigir tabelas de RH. Diagnóstico específico de tabela deve distinguir inexistência no schema, falta de SELECT e ausência de vínculo de unidade. Não confundir métrica legada ausente com indisponibilidade da fonte. Privilégios SQL do servidor não serão alterados automaticamente por uma resposta do modelo.
3. Preparação: identidade/permissões, fontes e panorama devem ser preparados antes de publicar a visão inicial. O contexto essencial usa fontes autorizadas e verificáveis; o estudo integral fica identificado como trabalho distinto. Mudanças de permissões invalidam o contexto. Falha precisa mostrar etapa e recuperação, nunca prontidão fictícia.
4. Consumo: medir entrada/saída informadas pelo provedor e mostrar consumo acumulado. O estudo profundo é opcional, com orçamento reservado antes de cada chamada, persistência e interrupção ao atingir o teto. Não reenviar documentos íntegros em cada login.
5. Progresso: separar aguardando, executando, concluído, interrompido por orçamento e erro. Mostrar última atualização, trechos e documentos processados. A contagem de documentos disponíveis não representa estudo concluído.
6. Reaproveitamento: preservar histórico, telas e fatos existentes. Preparar uma nova revisão não apaga dados anteriores. A aplicação deve revalidar o acesso ao recuperar conhecimento e ao executar consultas.

## Validação exigida

Testes de PostgreSQL/PGlite com tabelas de compras/itens sem unidade direta e unidades diferentes; testes de orçamento e reinício; acesso documental por unidade e programa; falha de preparação bloqueando o dashboard; ausência de progresso distinguida de espera; teste completo no navegador e build. Os testes sintéticos não comprovam a OC real do notebook.

## Limites explícitos

Não significa aprender literalmente todos os registros, treinar novos pesos do modelo, liberar tabelas de autenticação ou executar SQL livre. Tabelas sem vínculo de unidade precisam de mapeamento autorizado. Credenciais sem SELECT precisam de concessão administrativa no banco real. A cobertura dos arquivos fornecidos deve ser auditável: título, origem, revisão e conteúdo indexado, sem assumir que todos os arquivos de uma conversa foram importados na aplicação.

## Implementação e resultado da revisão 3

- Contexto essencial: seleciona até quatro fontes autorizadas, com até 650 caracteres por trecho, em uma chamada limitada a 1.600 tokens de saída. Reutiliza o resumo por revisão/permissões; não reenvia todo o acervo no login. Uma falha exige tentativa explícita para renovar o orçamento.
- Aprofundamento separado: começa pausado, teto de 8.000 tokens por autorização, reserva antes de chamar o provedor e progresso persistente inclusive dentro de trechos longos. Exibe consumo, caracteres e último avanço. Não equivale ao estudo integral de 274 documentos.
- A tela inicial permanece em preparação até concluir contexto essencial e validar o panorama. Dashboards e telas pessoais em preparação também ficam ocultos nas listagens da API.
- Consultas operacionais usam caminhos reais e únicos de até três relacionamentos para aplicar o isolamento por unidade. Diagnóstico específico distingue tabela inexistente, falta de SELECT e escopo não mapeado.
- O atualizador oferece ADA_CONFIGURE_BUSINESS_READONLY=1: concede somente SELECT faltante nas tabelas de negócio ordinárias/particionadas do schema public, excluindo tabelas técnicas protegidas. Confere que a fonte é o PostgreSQL local antes de alterar privilégios. Registra reversão em business-readonly.undo.sql na pasta privada de backup. Não cria concessões para futuras tabelas automaticamente. A volta do código anterior não revoga essas concessões automaticamente.
- Migração 0008 acrescenta apenas a posição do próximo caractere do estudo. Preserva conversas, telas, fatos e configurações.

Validação final: 152 testes em 29 arquivos, lint, tipos, compilação web/API/worker e verificação de segredos aprovados. Navegador local confirmou preparação, abertura do painel e boas-vindas com dados sintéticos, sem erros de console.

Pendente no ambiente real: executar a atualização SSH, confirmar a conexão operacional e localizar a SC/OC do notebook. A cobertura das fontes e os vínculos de unidade reais dependem do banco e dos documentos efetivamente indexados. Não foi realizada conexão SSH nem migração de produção nesta revisão.
