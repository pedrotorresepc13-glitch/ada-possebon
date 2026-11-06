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
### Fila persistente de mudanças do PostgreSQL

O SQL em `deploy/sql/possebon-change-outbox.sql` prepara a fila no banco do POSSEBON. O responsável pelo banco concede leitura de `posso_integration.change_outbox` ao usuário técnico da Posso e execução de `posso_integration.publish_change(jsonb)` exclusivamente aos produtores autorizados. Ambos precisam de `USAGE` no schema. O produtor chama a função dentro da transação de negócio e fornece somente campos previstos no contrato da fonte. O script não registra gatilhos em tabelas de negócio.

Para captura automática por tabela, o SQL também disponibiliza `capture_monitored_row()`. O DBA pode ligar um gatilho `AFTER INSERT OR UPDATE ... FOR EACH ROW` passando ID da fonte catalogada, coluna da chave, coluna da unidade e campos de interesse autorizados. A função inclui somente esses campos, ignora atualizações que não os alterem e participa da mesma transação do registro. Os monitores atuais consomem registros após criação ou alteração. Exclusões exigem um contrato de evento próprio.

Use `possebon.operational` para os acompanhamentos operacionais existentes. Nesse modo a fila carrega somente a tabela, a chave e a unidade. As colunas configuradas servem para detectar uma mudança na origem. O worker antecipa as verificações da tabela na mesma unidade, e cada acompanhamento consulta novamente o registro com a identidade atual do responsável.

Com `POSSEBON_OUTBOX_ENABLED=1`, o worker transfere lotes de até 100 eventos para a fila interna e grava o ponto de leitura na mesma transação. Uma lacuna ou evento inválido interrompe o lote. O cursor começa em zero, e a origem deve reter as sequências pendentes. A fila alimenta os monitores existentes. Cada tabela real ainda exige mapeamento de fonte, unidade e campos antes de ligar o gatilho.

## Leitura automática de novas tabelas

No banco operacional, o DBA habilita uma vez com `psql -v ON_ERROR_STOP=1 -v posso_role=ROLE_DE_LEITURA -f deploy/sql/possebon-auto-read.sql`. Use a mesma role técnica já configurada para consultas e verifique que ela tem USAGE no schema public. A instalação exige permissão para criar event triggers. A concessão automática cobre novas tabelas de negócio criadas no schema public e exclui nomes protegidos. Para tabelas anteriores à ativação, use a revisão de concessões existente em `scripts/deploy/business-readonly.ts`. Desabilitar o event trigger interrompe novas concessões. As concessões já feitas permanecem até revogação.

A autorização por unidade e as regras da aplicação continuam sendo avaliadas na consulta. Tabelas sem vínculo reconhecível com a unidade podem exigir mapeamento. O fluxo de eventos de alterações em registros segue a configuração separada da fila.
