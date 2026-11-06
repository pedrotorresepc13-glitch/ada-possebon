# ADA POSSEBON — Implantação no servidor POSSEBON

> **Nenhum deploy remoto foi executado.** Este roteiro e os arquivos em `deploy/` e `scripts/deploy/` precisam de revisão e autorização da infraestrutura.

## Requisitos
- Linux com Apache 2.4 (o mesmo do POSSEBON), PostgreSQL 15, **Node.js 22 LTS**, `git`, `curl`, `pg_dump`/`pg_restore`.
- Usuário de sistema `ada` (sem shell de login). Diretórios `/opt/ada/releases`, `/etc/ada` (modo 750) e `/var/backups/ada` (700).
- Nenhuma porta nova exposta: o Node escuta em `127.0.0.1:4800` (API) e `127.0.0.1:4801` (health do worker).

## Primeira instalação
1. **Banco** (DBA): revisar e aplicar `deploy/sql/roles.sql`. Definir senhas fora do arquivo. Ajustar `pg_hba.conf` para acesso local.
2. **Segredos:** criar `/etc/ada/ada.env` a partir de `.env.example` com `ADA_ENV=production`, `DATABASE_URL` do `ada_app`, `ADA_ENCRYPTION_KEY` (32 bytes base64, **com cópia em cofre**), `ADA_SSO_HS256_SECRET`, `POSSEBON_IDENTITY_URL`, `POSSEBON_SERVICE_TOKEN`, `ADA_INTERNAL_HMAC_SECRET`, `ADA_FRAME_ANCESTORS="'self' https://<dominio>"`, `ADA_ALLOWED_ORIGINS=https://<dominio>`, e **sem** `ADA_DEV_LOGIN`/`ADA_DEMO_DATA` (a configuração recusa iniciar com eles). Criar `/etc/ada/migrate.env` com `DATABASE_URL` do `ada_owner`.
3. **systemd:** copiar `deploy/systemd/ada-api.service` e `ada-worker.service` para `/etc/systemd/system/` e rodar `systemctl daemon-reload && systemctl enable ada-api ada-worker`.
4. **Código:** `sudo -E scripts/deploy/update.sh <tag>`. O script clona, roda `npm ci`, build, backup, migrations (com `ada_owner`), troca atômica do symlink, reinício e health check, e faz rollback do código se o health check falhar.
5. **Apache:** incluir `deploy/apache/ada.conf` no vhost HTTPS do POSSEBON, rodar `apachectl configtest` e recarregar.
6. **POSSEBON:** aplicar a proposta de `integration/possebon-web/` em homologação e depois em produção, com autorização.
7. **Aceite:** seguir o roteiro manual de `docs/ADA_TEST_PLAN.md`.

## Operação

### Entradas oficiais do POSSEBON Web

As origens HTTPS `https://app.possebon.com.br`, `https://app.possebon.com.br:19305` e `https://app.possebon.com.br:19302` publicam a Posso em `/ada/`. Cada entrada precisa servir `/ada-assistant.php` e encaminhar `/ada/` no próprio endereço. Em produção, incluir uma dessas origens em `ADA_ALLOWED_ORIGINS` habilita as três para a API. A integração PHP, quando configurada com uma dessas entradas em `ada_url`, emite o endereço da Posso na origem oficial em que o usuário abriu o POSSEBON Web. O proxy deve preservar o host e a porta públicos.

A atualização da API não copia `AdaIntegrationService.php` para o POSSEBON Web. Aplique e valide a alteração PHP separadamente no aplicativo, depois confirme a abertura da Posso com um usuário autorizado nas três origens.
| Tarefa | Comando |
|---|---|
| Atualizar | `sudo -E scripts/deploy/update.sh <tag>` |
| Saúde | `scripts/deploy/healthcheck.sh` · painel Administração › Saúde |
| Backup manual | `scripts/deploy/backup.sh` (padrão: retenção de 14 arquivos; agendar via cron/timer diário) |
| Rollback de código | `scripts/deploy/rollback.sh` |
| Rollback com banco | `scripts/deploy/rollback.sh --db /var/backups/ada/ada-AAAAMMDD-HHMMSS.dump` |
| Logs | `journalctl -u ada-api -u ada-worker` (JSON, segredos redigidos, sem conteúdo de conversas) |

**Migrations:** são aditivas por política. `0001 down` apaga o schema inteiro, por isso exige `ADA_CONFIRM_ROLLBACK=sim` em produção e backup verificado. Uma migration já aplicada não pode ser editada: o checksum divergente bloqueia a execução.

## Backup e restauração (testar periodicamente)
```bash
scripts/deploy/backup.sh                              # gera /var/backups/ada/ada-*.dump e valida com pg_restore --list
systemctl stop ada-worker ada-api
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /var/backups/ada/<arquivo>.dump
systemctl start ada-api ada-worker && scripts/deploy/healthcheck.sh
```
A chave `ADA_ENCRYPTION_KEY` precisa ser guardada junto da política de backup. Sem ela, conversas, memórias e credenciais restauradas ficam ilegíveis.

## Desenvolvimento local (Windows/Linux/macOS)
```bash
npm install
cp .env.example .env          # usa PGlite (.data/pglite), login sintético e dados SINTÉTICOS
npm run build -w @ada/web     # opcional: SPA servida pela API em /ada/
npm run dev:api               # http://127.0.0.1:4800/ada/  (worker embutido com PGlite)
npm run dev:web               # opcional: Vite com recarga em http://localhost:5173/ada/
```
