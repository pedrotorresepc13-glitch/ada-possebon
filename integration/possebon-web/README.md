# ADA POSSEBON — SSO isolado do MAD Builder (29/10/2026)

**Status: branch preparada; NÃO instalada em produção.** Comparação realizada contra o ZIP `possebon_web-28-10-2026-21-31-06.zip` e a versão real das classes `ApplicationAuthenticationService`, `SystemUsers`, `SystemGroup`, `SystemGroupProgram` e `SystemUserUnit`.

## Alteração mínima

A integração utiliza o novo `app/controller/AdaApiController.php`, sem editar `ApiAppController.php`. Esse novo controlador carrega exclusivamente os traits `AdaIdentityApiTrait.php` e `AdaBrainApiTrait.php`.

O único arquivo existente a ser alterado é `app/routes/api.php`, com **duas rotas adicionais**, ao final:

```php
Router::group(['prefix' => '/api/ada/v1'], function () {
    Router::get('/identity', 'AdaApiController::identidadeAda');
    Router::post('/brain/context', 'AdaApiController::contextoBrainAda');
});
```

O restante são **5 arquivos novos**: `AdaIntegrationService.php`, `AdaIdentityApiTrait.php`, `AdaBrainApiTrait.php`, `AdaApiController.php` e `AdaEmbedView.php`.

## Implantação protegida

No Windows VS Code, a partir do repositório atualizado nesta branch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Instalar_ADA_SSO.ps1
```

Isso **somente simula**: transfere um pacote temporário ao servidor, verifica o SHA-256 da rota viva, confere se as classes novas ainda não existem e executa `php -l`. Não modifica arquivos do sistema.

Depois de validar, para executar a instalação (alteração **real** de produção):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Instalar_ADA_SSO.ps1 -Aplicar
```

O script Linux bloqueia se `app/routes/api.php` diferir do snapshot de 28/10 (SHA-256 `56fd9ca8bdd8c1949502970a21fa331d5d00d0705dd93b7d0dacab1d6b7a430d`) ou se qualquer arquivo novo já existir. Ele guarda backup da rota em `$HOME/ada-sso-backups`, valida a sintaxe e restaura o original em caso de erro durante a instalação. **Não reverte nem sobrescreve alterações posteriores ao backup automaticamente**: exigir nova revisão.

## Regras reais de identidade

- `TSession::getValue('logged')` verdadeiro, `userid` e `userunitid` positivos, unidade na lista `userunitids`.
- O login do POSSEBON Web continua gerenciando senha/2FA.
- Um ticket SSO de 60 segundos assinado pelo servidor, limitado a um `jti` de uso único.
- O acesso requer `AdaEmbedView` ou `AdaAdministracao` presente nos programas do MAD Builder.
- A identidade para cada sessão da ADA é revalidada em `permission`; unidade não autorizada e usuário inativo são recusados pela ADA.
- Ações por grupo: `system_program.actions` (objetos JSON) ∩ `system_group_program.actions` (lista de nomes), com concedentes por programa direto em `system_user_program`. Valores ausentes não viram `*`.
- O escopo `AdaGestor` vale apenas como marca de papel gerencial e **não** dá acesso irrestrito aos dados operacionais.

## Ainda NÃO é login ativo

Faltam configurar: `app/config/ada.php` no POSSEBON Web (não versionar), `ADA_SSO_HS256_SECRET`, `POSSEBON_SERVICE_TOKEN` e `POSSEBON_IDENTITY_URL` na ADA, os programas/grupos autorizados no MAD Builder e um endereço **HTTPS seguro** acessível pelo navegador para a ADA.

Enquanto ela estiver em `127.0.0.1:4800`, não afirmar que o iframe remoto já permite login; teste local do endpoint servidor-servidor primeiro, e depois hospede a ADA num HTTPS apropriado. Evitar expor diretamente a porta de desenvolvimento.

Não instalar nada sem validação de versão e backup. Nenhum token do Mail Import ou do HOLO deve ser reutilizado.
