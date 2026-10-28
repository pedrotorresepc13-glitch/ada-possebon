# ADA POSSEBON — Integração com o POSSEBON Web

> Estado: **lado ADA implementado e testado; lado POSSEBON proposto e NÃO aplicado.**
> Artefatos: `docs/openapi-possebon-identity.yaml` (contrato) e `integration/possebon-web/` (PHP proposto + checklist).

## 1. Incorporação (iframe) e login único

| Passo | Onde | Detalhe |
|---|---|---|
| 1 | POSSEBON (`AdaEmbedView`) | Emite o ticket a partir de `TSession('userid','userunitid')`. HS256 com `sso_secret` em `app/config/ada.php` (fora do Git) |
| 2 | Navegador | Formulário oculto faz `POST ticket=…` para `/ada/api/ada/session/exchange`, com `target` no iframe |
| 3 | ADA | Valida e troca o ticket por sessão; responde 303 → `/ada/` |
| 4 | ADA → POSSEBON | `GET /api/ada/v1/identity?system_user_id=` com token técnico exclusivo |

**Hospedagem recomendada:** `https://<dominio-possebon>/ada/`, no **mesmo site**. O cookie `SameSite=Lax` funciona dentro do iframe sem depender de cookies de terceiros, que vêm sendo bloqueados pelos navegadores.

**Variáveis na ADA:** `ADA_SSO_HS256_SECRET`, `ADA_SSO_ISSUER=possebon-web`, `ADA_SSO_AUDIENCE=ada-possebon`, `POSSEBON_IDENTITY_URL`, `POSSEBON_SERVICE_TOKEN`, `ADA_FRAME_ANCESTORS="'self' https://<dominio-possebon>"`, `ADA_ALLOWED_ORIGINS=https://<dominio-possebon>`.

## 2. Revogação e eventos (servidor-servidor, HMAC)

Assinatura: `X-ADA-Timestamp: <unix>` e `X-ADA-Signature: sha256=hex(HMAC_SHA256(ADA_INTERNAL_HMAC_SECRET, "<timestamp>.<corpo>"))`, com janela de 5 minutos.

```php
// Exemplo (proposto) — chamar no logout e na alteração de grupos/unidades do usuário:
$body = json_encode(['system_user_id' => $userId, 'reason' => 'logout_no_possebon']);
$ts = time();
$sig = 'sha256=' . hash_hmac('sha256', "{$ts}.{$body}", $hmacSecret);
// POST http://127.0.0.1/ada/api/ada/internal/revoke  (headers X-ADA-Timestamp, X-ADA-Signature, Content-Type: application/json)
```

Eventos para monitores (outbox de OS, por exemplo) usam `POST /internal/events` com `NormalizedEvent` (`source`, `recordKey`, `unitId`, `occurredAt`, `eventId`, `record`). São idempotentes por `(source, eventId)`. A fonte precisa estar catalogada.

## 3. Dados reais (próximo passo, depende de validação)

Ordem recomendada:
1. Escolher **uma** métrica de alto valor (ex.: efetivo diário por equipe, tabela `efetivo` com `unit_id`, `data`, `equipe_id`, `status`, `deletado_em`).
2. Validar a fórmula com o dono do negócio (quais `status` contam como presente? `deletado_em IS NULL`?).
3. Implementar `SourceAdapter` com uma de duas opções:
   - **API REST** do POSSEBON (preferível);
   - **VIEW** de leitura no schema `ada_leitura`, com papel `ada_possebon_reader` somente leitura e `statement_timeout`.
4. Registrar no catálogo com `status: 'validado'`, programas exigidos reais (ex.: `EfetivoList`) e testes com dados de homologação.
5. Habilitar o conector como `ativo` **somente** depois do teste de conexão e da conferência dos números contra o POSSEBON.

Até lá, **nenhum número real aparece na ADA** e o catálogo de produção fica vazio.

## 4. POSSEBON Brain

Endpoints existentes: `/api/app/brain/status|context|feedback`, que usam o token técnico do Mail Import. Para a ADA:
- criar uma credencial técnica **própria** com escopo reduzido (somente `status`/`context`);
- aplicar a autorização do usuário também ao resultado. O Brain deriva `unit_id` da credencial, o que não basta para multiusuário;
- tratar o conteúdo do Brain como conhecimento técnico/normativo global, não como dado restrito de unidade.

Status: conector `possebon.brain` registrado como **não configurado**.

## 5. Pendências que dependem do POSSEBON

- Implantar e validar o endpoint de identidade e a página de incorporação (checklist em `integration/possebon-web/README.md`).
- Definir a regra de escopo gerencial.
- Confirmar se vínculos Pessoa/Colaborador concedem unidade além de `system_user_unit`.
- Rotacionar a chave da conta de serviço Firebase exposta no repositório `possebon_web`.
