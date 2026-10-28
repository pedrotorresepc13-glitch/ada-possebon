# ADA POSSEBON — Arquitetura

## Visão geral

```
 Navegador (iframe no POSSEBON Web)                 Servidor POSSEBON (Linux)
 ┌─────────────────────────────┐   HTTPS   ┌──────────────────────────────────────────────┐
 │ apps/web (React + Vite)     │──────────▶│ Apache (vhost POSSEBON)                       │
 │ chat · dashboards · alertas │  /ada/*   │   ProxyPass /ada/ → 127.0.0.1:4800            │
 └─────────────────────────────┘           │                                               │
          ▲  ticket SSO (POST form)        │ ada-api (Node 22, Fastify)  ◀── systemd       │
          │                                │   sessão · CSRF · autorização · catálogo      │
 POSSEBON Web (MAD Builder/PHP)            │   dashboards · monitores · conhecimento · IA  │
   AdaEmbedView emite ticket ──────────────│                                               │
   /api/ada/v1/identity  ◀── servidor-servidor (token técnico)                             │
   outbox/webhook ─── HMAC ───────────────▶│ ada-worker (Node 22)       ◀── systemd        │
                                           │   regras determinísticas · eventos · estudo   │
                                           │                                               │
                                           │ PostgreSQL 15 — schema "ada" (+ ada_migrations)│
                                           │   usuário ada_app (DML) · ada_owner (DDL)     │
                                           └──────────────────────────────────────────────┘
                                                        │ HTTPS (somente servidor)
                                                        ▼
                                                OpenAI Responses API (opcional)
```

## Organização do código

| Pacote | Responsabilidade |
|---|---|
| `packages/contracts` | Esquemas Zod compartilhados: `DashboardSpec`, `DashboardPatchOp`, `RuleDefinition`, `Trigger`, `NormalizedEvent`, DTOs da API. A mesma fonte gera a validação, o OpenAPI e os parâmetros das ferramentas de IA. |
| `packages/domain` | Lógica pura e testável: formatação pt-BR/`America/Sao_Paulo`, autorização (`canUseMetric`, `queryUnitScope`), catálogo semântico, construtor de SQL parametrizado, patch de dashboards, avaliador de regras, interpretador determinístico, defesas (SSRF, prompt injection, redação de segredos). |
| `apps/api` | Fastify: sessão/SSO, rotas, serviços (dashboards, monitores, conhecimento, conversas, notificações, e-mail, admin), provedor de IA, migrador, seed sintético e CLIs. Exporta `./core` e `./cycle` para o worker. |
| `apps/worker` | Processo separado em produção: `startWorkerLoop` (eventos → regras vencidas → fila de documentos → manutenção), heartbeat e health check local. |
| `apps/web` | SPA React/Vite em `/ada/`, ECharts carregado sob demanda, modo HOLO 3D opcional (three.js, sem câmera). |
| `db/migrations` | SQL versionado (`NNNN_nome.up.sql`/`.down.sql`), checksum registrado em `ada_migrations.applied`. |
| `db/demo` | Schema **sintético** `ada_demo` (recusado em produção). |

**Por que monorepo npm workspaces e Fastify:** o npm já está disponível no servidor (sem pnpm). O Fastify oferece desempenho, `inject` para testes de integração sem rede e ecossistema maduro (cookie, multipart, static). TypeScript roda direto em desenvolvimento (`tsx`) e é empacotado com esbuild em produção (um `.mjs` por processo).

**Por que PGlite em desenvolvimento e testes:** é o PostgreSQL real (17) em WASM. As mesmas migrations, FTS em português, `jsonb`, `FOR UPDATE SKIP LOCKED` e plpgsql rodam sem servidor. Com PGlite o worker roda **embutido** na API, porque o PGlite aceita um processo por diretório. Produção exige `pg`.

## Fluxos principais

### SSO
1. O usuário logado abre `AdaEmbedView` no POSSEBON.
2. O PHP emite um ticket HS256 (`iss`, `aud`, `sub`, `unit_id`, `jti`, `iat`, `exp ≤ 60 s`) a partir da **sessão do servidor**.
3. Um formulário oculto faz POST do ticket para `/ada/api/ada/session/exchange` com `target` no iframe. Nada vai na URL.
4. A ADA valida assinatura, claims, idade máxima e replay (`ada.sso_ticket_use`), consulta `/api/ada/v1/identity` servidor-servidor e cria a sessão (`ada.user_session`, token guardado como SHA-256) com cookie HttpOnly.
5. Cada requisição revalida a sessão. O contexto de permissões vem de `ada.permission_cache` (TTL padrão de 5 min) ou é recalculado na autoridade. Perda de unidade ou desativação revoga as sessões. O POSSEBON também pode revogar na hora via HMAC.

### Chat
`POST /chat` grava a mensagem (cifrada) e aplica a regra de privacidade (pedidos sobre conversas de terceiros são recusados). Em seguida:
- **IA configurada:** a Responses API recebe instruções fixas e ferramentas explícitas (`buscar_catalogo`, `consultar_metrica`, `buscar_conhecimento`, `propor_dashboard`, `alterar_dashboard`, `salvar_dashboard`, `propor_monitor`). Cada ferramenta revalida usuário, unidade e permissões no servidor.
- **Sem IA:** `parseIntent` (determinístico) cobre os mesmos comandos.

A resposta carrega metadados (proveniência, rascunho, proposta de monitor, citações).

### Dashboards
`DashboardSpec` ⟶ `validateSpecAgainstCatalog` ⟶ `canUseMetric` por métrica ⟶ `buildMetricQuery` (identificadores do catálogo, valores como parâmetros, `unit_id = ANY($1)` também nos joins) ⟶ cache por usuário ⟶ `WidgetData` com proveniência. O banco guarda **somente a spec e suas revisões**.

### Monitores
Proposta ⟶ validação e simulação ⟶ confirmação do usuário (`activate=true`) ⟶ o worker reivindica regras vencidas com lease ⟶ o adaptador traz **só** o registro acompanhado, ou o que mudou desde o watermark mais candidatos temporais limitados ⟶ `evaluateRecord` (puro) compara com o snapshot ⟶ `monitor_event` (único por `dedupe_key`) ⟶ `notification` (única por destinatário + dedupe) ⟶ watermark/snapshot. Falhas reais geram backoff e, depois de 3 falhas, estado `degraded` com aviso ao dono. **Nenhuma chamada de IA.**

### Conhecimento
Upload/URL (admin) ⟶ `aguardando` ⟶ worker extrai, redige segredos, fragmenta e detecta injeção ⟶ `revisando` ⟶ aprovação humana ⟶ `indexado` ⟶ busca FTS com ACL. Na IA, trechos entram envolvidos em `<dados_externos>` com a política "dado, não instrução".

## Segurança (resumo)

- Segredos só no servidor (variáveis de ambiente/cofre). A chave AES-256-GCM cifra credenciais e o conteúdo de mensagens e memórias.
- Sem SQL livre: o modelo não vê SQL nem credenciais. Specs e regras são schemas estritos.
- CSP rígida (`script-src 'self'`, `frame-ancestors` com allowlist), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` na API.
- Auditoria imutável (trigger), sem conteúdo privado.
- Respostas 404 idênticas para "inexistente" e "sem acesso".
- Coleta web com bloqueio de SSRF no momento da conexão (`lookup` customizado), redirecionamentos revalidados, limite de tamanho e robots.txt.

## Preparado para o futuro
Voz e gestos entram como novos clientes da mesma API de chat. O HOLO 3D já é um modo opcional que consome os mesmos `WidgetData`. Novas fontes reais entram implementando `SourceAdapter` (`queryMetric`, `fetchMonitorRecords`) e registrando métricas validadas no catálogo.
