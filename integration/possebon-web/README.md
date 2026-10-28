# Integração POSSEBON Web ↔ ADA — PROPOSTA (não aplicada)

> **Status: preparado, NÃO aplicado.** Nenhum arquivo do POSSEBON Web (produção) ou do app Flutter foi
> modificado. O GitHub `possebon_web` não é o baseline de produção: compare com o **ZIP vivo mais recente**
> antes de qualquer cópia. Aplicação somente com autorização explícita e janela combinada.

## O que a ADA precisa do POSSEBON

| # | Item | Arquivo proposto | Necessário para |
|---|------|------------------|-----------------|
| 1 | Programas no MAD Builder: `AdaAdministracao`, `AdaGestor`, (opcional) `AdaConsolidarUnidades`, `AdaAcesso`, `AdaEmbedView` | criar pelo **Builder** (Admin › Programas) e vincular aos grupos | papéis na ADA |
| 2 | Página de incorporação com ticket SSO | `App/control/AdaEmbedView.php` | login único no iframe |
| 3 | Endpoint servidor-servidor de identidade | `App/custom/AdaIdentityApiTrait.php` + `AdaIntegrationService.php` | permissões autoritativas |
| 4 | Configuração com segredos (fora do Git) | `App/config/ada.php.example` → `app/config/ada.php` | assinatura e token técnico |
| 5 | (Opcional) revogação imediata no logout/troca de grupo | chamada HMAC a `POST /ada/api/ada/internal/revoke` | revogação < 5 min |
| 6 | (Futuro) outbox/webhook de mudanças de OS etc. | chamada HMAC a `POST /ada/api/ada/internal/events` | monitores por evento |

## Patch de rotas (App/routes/api.php)

```php
// ADA — identidade servidor-servidor (token técnico exclusivo; restringir IP no Apache)
Router::group(['prefix' => '/api/ada/v1'], function () {
    Router::get('/identity', 'ApiAppController::identidadeAda');
});
```

E em `ApiAppController.php`:

```php
require_once 'app/custom/AdaIdentityApiTrait.php';
// ...
class ApiAppController
{
    use AdaIdentityApiTrait;
```

## Checklist de validação antes de aplicar

- [ ] Conferir no baseline vivo os nomes das conexões (`permission`, `possebon_app`) e o formato de `system_group_program.actions`.
- [ ] Confirmar a regra de **escopo gerencial** (padrão proposto: programa `AdaGestor`; alternativa: `gerencia.gerente_id`/`equipe.responsavel_id`).
- [ ] Confirmar se usuários do app (vínculo Pessoa/Colaborador por unidade, ver `AppApiBearerMiddleware`) devem ganhar unidades além de `system_user_unit`.
- [ ] Gerar `sso_secret` (≥ 32 bytes aleatórios) e token técnico **exclusivo da ADA** — não reutilizar o token do Mail Import.
- [ ] Restringir `/api/ada/v1/identity` ao IP do servidor da ADA (mesmo host: 127.0.0.1).
- [ ] `php -l` em cada arquivo; teste em homologação com dois usuários de unidades diferentes.
- [ ] Testes de aceite da ADA: `docs/ADA_TEST_PLAN.md` § SSO/iframe.

## Achado de segurança no repositório `possebon_web` (GitHub)

`App/config/firebase_service_account.json` está versionado e contém o campo `private_key` (o valor não
foi lido nem copiado). Recomenda-se **revogar/rotacionar a chave no Google Cloud**, remover o arquivo do
repositório (e do histórico) e carregá-lo apenas do servidor.
