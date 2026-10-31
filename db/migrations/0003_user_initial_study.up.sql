-- Estudo inicial privado, isolado por usuário, unidade e versão de permissão.
-- Conteúdo cifrado pela chave estável da ADA; não cria cópias das tabelas de negócio.
CREATE TABLE ada.user_initial_study (
  system_user_id integer NOT NULL REFERENCES ada.user_identity_map(system_user_id),
  unit_id integer NOT NULL,
  permission_fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('running','ready','partial','error')),
  report_enc text,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system_user_id, unit_id)
);
