-- =============================================================================
-- ADA POSSEBON — papéis PostgreSQL de privilégio mínimo (executar como superusuário/DBA).
-- Revisar com o DBA antes de aplicar. Senhas NUNCA neste arquivo: use \password ou cofre.
-- =============================================================================

-- Dono do schema: usado SOMENTE para migrations (scripts/deploy/update.sh).
CREATE ROLE ada_owner LOGIN NOINHERIT;
-- Aplicação (API e worker): somente DML nas tabelas do schema ada.
CREATE ROLE ada_app LOGIN NOINHERIT;

-- O schema ada pertence ao ada_owner (criado pela migration 0001 conectada como ada_owner).
-- Pré-crie para fixar a posse e conceder uso:
CREATE SCHEMA IF NOT EXISTS ada AUTHORIZATION ada_owner;
CREATE SCHEMA IF NOT EXISTS ada_migrations AUTHORIZATION ada_owner;
GRANT CONNECT ON DATABASE <BANCO> TO ada_owner, ada_app;
GRANT CREATE ON DATABASE <BANCO> TO ada_owner; -- necessário apenas se a migration criar schemas

-- Nenhum acesso ao schema public/tabelas do MAD Builder:
REVOKE ALL ON SCHEMA public FROM ada_app;

GRANT USAGE ON SCHEMA ada TO ada_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ada_owner IN SCHEMA ada GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ada_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ada_owner IN SCHEMA ada GRANT USAGE, SELECT ON SEQUENCES TO ada_app;
-- Após rodar as migrations, garanta também para objetos existentes:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ada TO ada_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ada TO ada_app;
-- A trilha ada.audit_event é protegida por trigger (somente INSERT), inclusive para ada_app.

-- Leitura restrita do POSSEBON (conector futuro, desabilitado por padrão):
-- crie VIEWS específicas e aprovadas, nunca acesso a tabelas inteiras ou system_*/credenciais.
-- CREATE ROLE ada_possebon_reader LOGIN NOINHERIT;
-- CREATE SCHEMA ada_leitura AUTHORIZATION <dono_possebon>;
-- CREATE VIEW ada_leitura.efetivo_diario_v AS SELECT ... (colunas mínimas, com unit_id) ...;
-- GRANT USAGE ON SCHEMA ada_leitura TO ada_possebon_reader;
-- GRANT SELECT ON ada_leitura.efetivo_diario_v TO ada_possebon_reader;
-- ALTER ROLE ada_possebon_reader SET default_transaction_read_only = on;
-- ALTER ROLE ada_possebon_reader SET statement_timeout = '15s';

-- Conexões somente locais (pg_hba.conf): host <BANCO> ada_app,ada_owner 127.0.0.1/32 scram-sha-256
