-- Compatibilidade com a versão anterior: envio externo desabilitado.
UPDATE ada.integration_account SET sending_enabled=false WHERE sending_enabled=true;
ALTER TABLE ada.integration_account DROP CONSTRAINT IF EXISTS integration_account_sending_policy;
ALTER TABLE ada.integration_account ADD CONSTRAINT integration_account_sending_enabled_check CHECK (sending_enabled=false);
DROP TABLE IF EXISTS ada.email_draft;
