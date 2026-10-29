# ADA ↔ POSSEBON Brain vivo — leitura segura (29/10/2026)

## Fonte atual

Conferido com o ZIP **possebon_web-28-10-2026-21-31-06.zip**. No MAD Builder:
- `app/custom/PossebonBrainApiTrait.php` usa `documentoMailImportAutenticar()` nos endpoints atuais `/api/app/brain/*`. **Não reutilizá-los com o token do Mail Import.**
- `app/custom/PossebonBrainService.php::context()` chama `ensureTables()`, que pode executar `CREATE/ALTER` mesmo em chamadas de busca. A ADA **não** chama esse método.
- As tabelas de conhecimento são `possebon_ai_knowledge`; escopo é `unit_id IS NULL OR unit_id = unidade_ativa`; somente `status='ACTIVE'`.
- A autenticação real está em `ApplicationAuthenticationService.php`, com `TSession('userid')`, `TSession('userunitid')` e `TSession('userunitids')`.
- `permission` contém `system_users`, `system_user_unit`, `system_program`, grupos e programas.

## Status honesto

**Implementado na branch:** cliente Node de leitura, integração do chat em modo IA e determinístico, API autenticada `GET /ada/api/ada/brain/status` e `GET /ada/api/ada/brain/context?q=...`, testes de isolamento de unidade e autorização, trait PHP de endpoint somente leitura.

**NÃO ATIVO:** o PHP do POSSEBON não foi instalado, SSO ainda não foi ligado, os segredos do canal ADA não foram configurados e, por isso, a ADA local ainda não consulta o Brain vivo. Nenhum dado foi alterado no servidor POSSEBON. O endpoint preparado é específico da ADA, não altera nem chama o Mail Import.

## Instalação futura no MAD Builder, após homologação

A partir dos arquivos corrigidos de SSO (validar sempre com ZIP/backend vivo):
1. Cadastrar no MAD Builder os programas `AdaAcesso`, `AdaAdministracao` e opcionalmente `AdaConhecimentoTecnico`; vincular a grupos reais. **Não conceder acesso técnico só porque o usuário usa a ADA.** `AdaConhecimentoTecnico` autoriza as áreas `rule`, `model`, `schema`; `AdaAdministracao` também autoriza `permission`. Não concede acesso a dados pessoais ou operacionais.
2. Adicionar `app/custom/AdaBrainApiTrait.php` (este repositório). **Não copiar modelos gerados do MAD Builder nem substituir arquivos desatualizados.**
3. No `ApiAppController.php`, junto aos `require_once` existentes, acrescentar:
   ```php
   require_once 'app/custom/AdaBrainApiTrait.php';
   ```
   E dentro da classe:
   ```php
   use AdaBrainApiTrait;
   ```
4. Em `app/routes/api.php`, fora do grupo técnico do Mail Import, adicionar uma única rota ao grupo SSO da ADA, ou criar este grupo se ausente:
   ```php
   Router::group(['prefix' => '/api/ada/v1'], function () {
       Router::post('/brain/context', 'ApiAppController::contextoBrainAda');
   });
   ```
   Se o SSO já adicionou `/api/ada/v1/identity`, **não criar a rota duas vezes**.
5. Colocar `POSSEBON_SERVICE_TOKEN` (token exclusivo ADA, não Mail Import) apenas no `.env` da ADA; no POSSEBON `app/config/ada.php`, guardar somente `service_token_sha256` do mesmo token. Usar HTTPS autenticado, limitação de IP/rede quando possível, e não permitir a API em HTTP público.
6. No `.env` da ADA, configurar:
   ```dotenv
   POSSEBON_IDENTITY_URL=https://app.possebon.com.br:19302/api/ada/v1/identity
   POSSEBON_BRAIN_CONTEXT_URL=https://app.possebon.com.br:19302/api/ada/v1/brain/context
   # POSSEBON_SERVICE_TOKEN=valor-exclusivo-ada  (local, nunca Git)
   ```
   **Essas URLs são caminhos propostos, não endpoints comprovadamente publicados**. Validar roteamento HTTPS real, porta, proxy e certificado no ambiente antes de habilitar.
7. Validar com um usuário real: usuário sem programa, com programa técnico, administrador, usuário de outra unidade, desativação, alteração de grupo, troca de unidade. Confirmar que o texto retornado nunca contém registros de pessoas e que não é possível consultar `namespace=code`, `feedback` ou `sync`.
8. Só depois ligar a ADA local por conexão HTTPS segura e testar o iframe. O endereço `127.0.0.1:4800` não é acessível pelo navegador em outro host como um site público e não deve ser exposto à internet.

## Proteções da integração

- Autorização **dupla**: Node bloqueia usuário sem programa e o PHP revalida identidade/unidade/grupos com o banco do POSSEBON. Mesmo administradores ficam restritos à unidade ativa.
- Consulta parametrizada, `READ ONLY`, `statement_timeout=3000ms`, apenas `ACTIVE`; 8 itens, 1.200 caracteres por item e limite de 8.000 caracteres por resposta.
- A ferramenta de IA recebe o conteúdo **como dado não confiável** com `wrapUntrusted` e não executa instruções contidas no Brain.
- Conteúdo de código fonte `namespace=code`, `payload` JSON, credenciais e e-mails não fazem parte da resposta.
- Se não configurado, a ADA continua consultando somente a base local. Se o Brain falhar, a ADA sinaliza indisponibilidade, nunca fabrica resultados.
- O cliente só mostra dados com proveniência; o campo `source_updated_at` pode faltar e então apresenta como data não informada.

## Limites

Esta etapa oferece **conhecimento técnico do sistema**, não equivale a conhecer cronogramas, efetivo, documentos, previsões ou contratos atualizados. Para esses dados, serão necessários novos adaptadores determinísticos autorizados no POSSEBON Web, sempre com regra de negócio e filtragem por unidade.

A integração não substitui o POSSEBON Brain nem sincroniza automaticamente todo seu conteúdo para a ADA: consulta em tempo real, mediante necessidade do usuário.
