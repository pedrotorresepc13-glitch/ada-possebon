# ADA POSSEBON — Escopo e status real

Legenda: **✅ implementado e testado** (teste automatizado ou smoke contra o build real) · **🟡 implementado sem validação operacional** (código pronto, sem prova no ambiente real) · **🧪 demonstração/sintético** · **🔌 depende de credencial/servidor** · **📋 planejado**

Branch `feat/ada-possebon-foundation`. **86 testes automatizados passando, smoke HTTP 15/15.**

## Entrega A — Fundação

| Item | Status | Evidência |
|---|---|---|
| Monorepo (contracts, domain, api, worker, web), TypeScript estrito, ESLint | ✅ | `npm run lint`, `npm run typecheck` |
| Schema `ada` com migrations up/down versionadas e checksum, auditoria imutável | ✅ | `tests/ai-migrations.test.ts` |
| SSO por ticket (HS256/EdDSA, ≤ 60 s, uso único, audiência/emissor, replay) | ✅ (lado ADA) / 🔌 (emissão no POSSEBON) | `tests/sso-session.test.ts`; proposta em `integration/possebon-web/` |
| Sessão própria com cookie HttpOnly/Secure/SameSite, CSRF, checagem de Origin, expiração por inatividade | ✅ | `tests/sso-session.test.ts` |
| Contexto de permissões vindo do POSSEBON, com cache TTL, revogação HMAC e invalidação por perda de unidade ou desativação | ✅ (com identidades sintéticas) / 🔌 (endpoint real) | `tests/sso-session.test.ts` |
| Isolamento entre usuários, unidades, gerentes e admin | ✅ | `tests/isolation.test.ts` |
| Iframe: CSP `frame-ancestors` com allowlist, sem `X-Frame-Options` | ✅ | testes e smoke; `deploy/apache/ada.conf` |
| Login de desenvolvimento com usuários sintéticos (proibido em produção) | ✅ 🧪 | `loadConfig` recusa em produção |
| Interface principal sem dados fictícios do protótipo | ✅ | `apps/web` (capturas verificadas em Edge headless) |
| CI expandida | 🟡 | workflow escrito; ainda não executado no GitHub (branch não enviada) |

## Entrega B — Cérebro

| Item | Status |
|---|---|
| Fontes de conhecimento por escopo (global, unidade, domínio), sensibilidade e programas exigidos | ✅ |
| Upload em lote, checksum, deduplicação e versão; fila aguardando → processando → revisando → indexado/erro | ✅ |
| Extração TXT/MD/CSV/JSON/HTML | ✅ |
| Extração PDF/DOCX/XLSX/OCR | 📋 (fica em **erro explícito**, com o arquivo preservado para reprocessar) |
| Aprovação humana antes de indexar; detecção e sinalização de prompt injection | ✅ |
| Busca FTS em português com ACL (unidade, programas, validade) e citação (título, checksum, data de observação) | ✅ |
| Busca semântica (pgvector) | 📋 opcional; não bloqueia a instalação |
| Importação de URL com bloqueio de SSRF (IP checado na conexão), robots.txt e limites | ✅ bloqueios testados / 🟡 coleta real de sites não testada (sem rede externa nos testes) |
| Antivírus em uploads | 📋 hook previsto (ClamAV); hoje só são aceitos tipos de texto |
| Bridge POSSEBON Brain | 🔌 conector registrado como "não configurado"; requer credencial própria da ADA |
| Painel de cobertura e progresso | ✅ |

## Entrega C — Dashboards conversacionais

| Item | Status |
|---|---|
| Spec declarativa versionada (Zod estrito, sem HTML/JS/SQL), validada contra o catálogo | ✅ |
| Patch incremental (tipo de gráfico, período, comparação, agrupamento, filtro, controles), desfazer e revisões | ✅ |
| SQL parametrizado só a partir do catálogo, com escopo de unidade obrigatório também nos joins | ✅ |
| Persistência só da definição; reabertura busca valores atuais e reaplica permissões | ✅ |
| Cache curto por usuário + unidades + versão de permissões + parâmetros; "Atualizar"; aviso de dado desatualizado | ✅ |
| Compartilhamento com ACL (gestor/admin); destinatário precisa de permissão em cada métrica | ✅ |
| Componentes: KPI, linha, barra, área, pizza/rosca, empilhado, tabela, meta × realizado, distribuição | ✅ (render verificado visualmente: barras + meta, tema claro/escuro, mobile) |
| Exportação CSV (pt-BR, neutralização de fórmulas, proveniência) | ✅ · PDF 📋 |
| Exemplos: efetivo por equipe, treinamentos, OS por status, solicitações de compra | ✅ 🧪 (**sintéticos**; nenhuma métrica real validada) |
| Métricas reais do POSSEBON | 🔌 o catálogo de produção começa **vazio** |

## Entrega D — Monitores determinísticos

| Item | Status |
|---|---|
| RuleDesigner (interpretador determinístico + IA via ferramenta `propor_monitor`) | ✅ |
| RuleValidator, RulePreview/Simulator, RuleRegistry com revisões | ✅ |
| Gatilhos: campo alterado, status, criação, sem atualização, prazo próximo/vencido, limiar, variação %; composição any/all | ✅ |
| Worker: lease + `SKIP LOCKED`, watermark, candidatos temporais limitados (sem varredura total), backoff, degradação, recuperação após reinício | ✅ |
| Deduplicação e idempotência (evento e notificação), cooldown | ✅ |
| Eventos por webhook/outbox (HMAC, idempotente por `eventId`) | ✅ (lado ADA) / 🔌 (emissão no POSSEBON) |
| **Zero chamadas de IA no ciclo** | ✅ (provedor espião nos testes; `ai_calls = 0` em cada execução) |
| Explicação opcional de ocorrência por IA | 📋 (gancho previsto, desligado) |
| Pausar, retomar, testar, histórico, editar e excluir pela interface | ✅ |
| Monitor de OS real | 🔌 não existe fonte de OS catalogada no POSSEBON conhecido |

## Entrega E — Integrações administrativas

| Item | Status |
|---|---|
| Painel admin (saúde, conhecimento, conectores, e-mail, IA/custos, políticas, auditoria), bloqueado na navegação e na API | ✅ |
| Contas de e-mail: credencial cifrada (AES-256-GCM), nunca retornada; ACL por usuário/grupo/unidade | ✅ |
| Teste de login IMAP por TLS | 🟡 (código real, sem servidor IMAP no teste) |
| Sincronização e indexação de e-mails | 📋 (contrato e armazenamento prontos) |
| Envio de e-mail | 📋 **bloqueado no schema** (`CHECK sending_enabled = false`) |
| Gmail / Microsoft Graph OAuth | 🔌 "não configurado" |
| Provedor OpenAI (Responses API, function calling, `store:false`, timeout, cota diária, rate limit, fallback) | 🟡 testado com `fetch` simulado; 🔌 sem chave real |
| Deploy: Apache, systemd, papéis PG, update/backup/rollback/healthcheck | 🟡 escrito; **não executado** em servidor (sem autorização/acesso) |

## Futuro (arquitetura preparada, não implementado)

Ações que alteram o POSSEBON, envio de e-mail, voz bidirecional, gestos como entrada principal, análise preditiva, workflows administrativos, RLS no PostgreSQL como defesa em profundidade, auditoria excepcional de conteúdo privado (procedimento separado), push/e-mail de notificações.
