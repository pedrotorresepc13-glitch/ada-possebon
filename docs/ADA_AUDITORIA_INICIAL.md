# ADA POSSEBON — Auditoria inicial do repositório

**Data:** 27/10/2026 · **Repositório:** `pedrotorresepc13-glitch/holo-gestures` · **Base auditada:** `main@81b46058f326804dd629e10c115e22df160585bd`

## 1. Confirmação do checkout

- A pasta local de trabalho não era um repositório git. O HEAD remoto de `main` foi confirmado por `git ls-remote` (`81b4605…`), e os **35 arquivos locais foram comparados por hash de blob git com `main`: 35/35 idênticos**.
- A pasta foi ligada ao remoto sem alterar arquivos (`git init` + `fetch` + `reset` do índice), e o trabalho segue na branch **`feat/ada-possebon-foundation`**. `main` não foi alterada e nada foi enviado ao GitHub.
- Ambiente local: Windows 11, Node 24 (alvo de execução: Node ≥ 22), **sem PostgreSQL e sem Docker**. Os testes usam **PGlite**, que é o PostgreSQL 17 real compilado em WASM. Em produção o alvo é o PostgreSQL 15 do servidor POSSEBON, via `pg`.

## 2. Inventário e decisão

| Item | O que é (verificado) | Decisão | Justificativa |
|---|---|---|---|
| `holo.html`, `server.py`, `holo.json`, `sample-notes/`, `props/`, `assets/banner.png` | HOLO Gestures original: notas espaciais, gestos MediaPipe, servidor Python stdlib na porta 4890 | **Manter (intocado)** | Base do repositório e demonstração original. `scripts/check-legacy.mjs` verifica na CI que esses arquivos continuam presentes. |
| `vendor/` (three.js, GLTFLoader, MediaPipe Tasks Vision + wasm com *HOLO SHIM*) | Bibliotecas de terceiros auto-hospedadas | **Manter** | Licenças MIT/Apache-2.0 preservadas em `LICENSE`. A ADA usa `three` via npm no modo HOLO opcional e não depende de `vendor/`. |
| `LICENSE`, `README.md` | MIT e atribuições do HOLO | **Manter** | Exigência de licença e atribuição. |
| `index.html`, `studio/app.js`, `studio/style.css` | Protótipo "HOLO Enterprise": mapa 3D, chat por palavras-chave, métricas inventadas | **Remover do produto final, sem apagar** | Substituído por `apps/web`. Continua disponível como demonstração estática. Não faz parte da ADA. |
| `studio/demo.js` | Dados **fictícios** explicitamente marcados | **Remover do produto final** | A ADA nunca exibe esses números. Os dados sintéticos da ADA ficam no schema `ada_demo`, rotulados e bloqueados em produção. |
| `studio/app.js` → `http://127.0.0.1:4892/api/assist` | Chamada a uma ponte local, bloqueada fora de localhost | **Substituir** | Trocada pela API same-origin autenticada `/ada/api/ada/*`. |
| `services/assistant-server.mjs` | Ponte Node local (127.0.0.1:4892) para Ollama/API externa, sem identidade, autorização ou memória | **Substituir** | `apps/api` assume essas funções com sessão, autorização POSSEBON, memória multiusuário e provedor OpenAI no servidor. O arquivo fica no repositório como referência do protótipo. |
| `vercel.json` (`X-Frame-Options: DENY`) | Cabeçalhos do site estático na Vercel | **Manter para o site estático** | A ADA **não** roda na Vercel (precisa de Node persistente e worker). A política de iframe da ADA é `CSP frame-ancestors` com allowlist estrita, emitida pela própria ADA, sem `X-Frame-Options`. No Apache do POSSEBON, `X-Frame-Options` é removido **só** em `/ada/` (`deploy/apache/ada.conf`). |
| `README-ENTERPRISE.md`, `docs/ARQUITETURA-EMPRESARIAL.md` | Declaram que não há conector, autenticação nem memória | **Adaptar como referência histórica** | Úteis como visão de origem, não como prova de implementação. O estado real está em `docs/ADA_ESCOPO_E_STATUS.md`. |
| `.github/workflows/enterprise-static-check.yml` | Só checava sintaxe | **Adaptar (expandido)** | Agora executa lint, typecheck, testes, build, verificação do legado, varredura de segredos, `npm audit` e smoke HTTP com o build real. |

## 3. Repositórios de contexto (somente leitura)

- **`possebon_web` (GitHub, `06cb2a9`, 21/10/2026).** Este **não é** o baseline de produção.
  - Autorização: `SystemPermission::checkPermission` consulta `TSession('programs')`. A origem é `system_user_group → system_group_program(actions)` mais `system_user_program`. Unidades vêm de `system_user_unit`, e `system_users.system_unit_id` é a unidade padrão. Os modelos conferidos foram `SystemGroup`, `SystemUserGroup`, `SystemGroupProgram`, `SystemPermission`, `SystemUserUnit`, `SystemUserProgram` e `SystemProgram`.
  - `SystemGroup` define constantes (`GRUPO_CLIENTE = 2`, `GRUPO_ATENDENTE = 3`). A ADA **não** usa IDs fixos de grupo: os papéis vêm de **programas**.
  - `AppApiBearerMiddleware` mostra uma exceção relevante: uma unidade pode ser válida por `system_user_unit` **ou** por vínculo de Colaborador/Pessoa. Fica registrado como pendência de validação da regra efetiva completa.
  - POSSEBON Brain (`/api/app/brain/status|sync|context|feedback`) usa o **token técnico do Mail Import** e deriva `unit_id` da credencial. A ADA **não** reutiliza esse token: o bridge exige credencial própria (pendente).
  - Entidades com `unit_id` encontradas: `efetivo`, `equipe`, `gerencia`, `colaborador`, além de treinamentos (`EdTreinamentos`). **Não há modelo de OS nem de solicitação de compra no catálogo do GitHub.** Os exemplos de OS e compras da ADA são, portanto, **sintéticos**, até que essas fontes sejam confirmadas no backend vivo.
  - Não existe endpoint para a ADA emitir ticket SSO nem para resolver identidade. Foi entregue um contrato com proposta isolada em `integration/possebon-web/`, **não aplicada**.
  - ⚠ **Achado de segurança:** `App/config/firebase_service_account.json` está versionado e contém `private_key`. O valor não foi lido. Recomendação: rotacionar a chave e remover o arquivo do repositório e do histórico.
- **`possebon-neural-memory` (`0654f66`).** Memória de **desenvolvimento** do app Flutter, com invariantes como `UNIT-001`, `SESSION-001`, `SECRETS-001` e `EVIDENCE-001`. A ADA respeita esses princípios (unidade como fronteira, falha de rede não derruba a sessão, nenhum segredo no Git, nada marcado como aplicado sem evidência). Essa memória **não** foi misturada com a memória operacional dos funcionários e nada foi gravado nesse repositório.

## 4. Riscos e bloqueios reais

1. **Backend vivo inacessível neste ambiente.** O SSO real e as permissões reais dependem da implantação do contrato `docs/openapi-possebon-identity.yaml` no POSSEBON Web.
2. **Escopo gerencial.** É uma regra de negócio ainda não definida. O padrão conservador proposto é o programa `AdaGestor`.
3. **Fontes de dados reais.** Nenhuma métrica real foi validada. O catálogo de produção fica vazio até a validação (sem números inventados).
4. **OpenAI.** O provedor está implementado e testado com `fetch` simulado. Não houve chamada real, porque não há chave neste ambiente.
5. **PHP.** A proposta não passou por `php -l`, pois não há PHP neste ambiente.
