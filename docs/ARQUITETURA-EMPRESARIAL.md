# Arquitetura-alvo: HOLO Enterprise (não implementada integralmente)

## Visão
Plataforma multiempresa com experiência espacial 3D, fala, gestos, chat e painel convencional. Uma organização poderá:
- começar do zero, utilizando armazenamento gerenciado por ela ou pela plataforma;
- conectar bancos e APIs existentes sem migração obrigatória;
- misturar dados internos e externos por entidades semânticas autorizadas;
- criar apresentações e análises auditáveis, sempre com referência à origem dos dados.

O protótipo atual serve apenas para validar interação e layout. Nenhum conector de produção, RBAC, autenticação de usuário ou memória contínua empresarial está implementado.

## Princípios não negociáveis
1. **Tenant isolado**: tenant_id sempre no contexto autenticado da sessão, nunca fornecido pelo modelo sem validação do servidor.
2. **Unidade contextual**: recursos e vínculos empresariais precisam de scoping por unit_id quando a origem operar por unidade.
3. **Nunca acessar credenciais pelo browser**: segredos em cofre do backend; tokens curtos e com escopo mínimo.
4. **Conectores com consultas permitidas**: nada de dar SQL arbitrário à IA; operações são serviços versionados que validam inputs.
5. **Acesso gerencial não é acesso irrestrito**: atribuições, grupos, permissões, campos sensíveis e mascaramento continuam sendo aplicados no backend.
6. **Aprendizado contínuo controlado**: metadados do schema, regras, definições de indicadores e descrição das APIs podem ser indexados; dados de colaboradores e outras informações pessoais não devem ir para memória da IA automaticamente.
7. **Reuniões e apresentações**: modo público com informações sensíveis redigidas, e confirmação antes de revelar novos detalhes no telão.
8. **Assistente ativa**: sem ações autônomas destrutivas; automações gravam quem criou, quando, justificativa, autorização, resultado e mecanismo de reversão.
9. **Observabilidade e custo**: logs de consultas, tempos, cache, tokens, provedores, falhas, alertas e orçamentos por empresa.
10. **Não romper sistemas existentes**: conectar POSSEBON/MAD Builder por endpoints vivos confirmados, nunca pelo repositório antigo do backend.

## Arquitetura lógica

- **Clients**: web em Vercel (estático/dinâmico), desktop via Tauri, interface CSS/Three.js.
- **Interações**: MediaPipe processando webcam localmente; transcrição com consentimento e opção de desativar.
- **Gateway**: autenticação OIDC, sessão, tenancies, autorização, rate limit, trilha de auditoria.
- **Camada semântica**: entidades canônicas, aliases, relacionamentos, métricas aprovadas, ações publicadas por conector, catálogo de proveniência.
- **Conectores**: MySQL, PostgreSQL, SQL Server, Firebase/Firestore, REST; cada um com esquema e driver próprios.
- **Sincronização**: tarefas incrementais por watermark, webhooks quando disponíveis, agendamento específico, captura de falhas e reprocessamento idempotente.
- **Engine de IA**: roteador de modelos (Ollama e modelos abertos self-hosted, ou APIs pagas); contexto compilado apenas de dados autorizados; validação de ferramentas; citações dos dados consultados.
- **Visualizador**: projetor de dados em métricas e cenas 3D. O modelo sugere a composição, mas não manipula DOM com scripts arbitrários.
- **Persistência de plataforma**: banco gerenciado por tenant ou implantação dedicada, arquivos e histórico de conversas, dashboards e visualizações.

## Contrato conceitual para cada fonte

Registro de fonte:
- id, tenant_id, source_type, display_name, status;
- region, auth_reference (cofre), allowed_units, allowed_operations;
- schema_version, last_sync_at, last_schema_hash, last_error;
- approved_entities, approved_metrics, personal_data_policy, retention_policy.

Contratos esperados:
- listEntities(context)
- describeEntity(context, entityId)
- queryMetric(context, metricId, filters)
- getRecords(context, entityId, approvedFilter, pagination)
- subscribeChanges(context, cursor) / syncChanges(context, cursor)

Cada resposta conterá fonte, data de atualização, unidade/empresa, status de permissão e advertências de qualidade.

## Migração gradual do protótipo

Fase 0 — feita: interface demonstrativa 3D em pt-BR, navegação, voz, gestos e ponte local de modelo híbrido.

Fase 1 — pendente: autenticador multiempresa, banco persistente, uma entidade própria criada do zero e isolamento robusto.

Fase 2 — pendente: adaptadores REST e PostgreSQL/MySQL reais com contratos de consulta, permissões, testes de autorização e no mínimo uma integração de homologação com dados fictícios.

Fase 3 — pendente: catálogo de regras/indicadores, indexação incremental e referências a resultados; testes contra prompt injection e exposição acidental de dados.

Fase 4 — pendente: modo reunião, captura de decisões, relatórios e exportação em PDF/PPTX com aprovação e origem dos números.

Fase 5 — pendente: integração POSSEBON Brain em modo leitura, mantendo unit_id e o acesso do usuário, sem alterar o MAD Builder existente.

## Hospedagem
Frontend na Vercel. Backend, filas, conectores e inferência podem rodar em serviço separado, container privado ou ambiente local conectado por mecanismo seguro, conforme infraestrutura. Vercel não é substituto automático para um servidor persistente Ollama/MySQL. Em modelo local, o computador que serve a inferência precisa estar ligado para aquela função; a experiência web pode continuar disponível com provedor em nuvem como fallback autorizado.
