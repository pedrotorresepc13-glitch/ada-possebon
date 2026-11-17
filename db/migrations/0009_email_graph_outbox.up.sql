-- Fluxo de correspondência Microsoft 365 do POSSO, no banco próprio da IA.
-- Não modifica nenhuma tabela de negócio do PostgreSQL POSSEBON.
ALTER TABLE ada.integration_account
  DROP CONSTRAINT IF EXISTS integration_account_sending_enabled_check;
ALTER TABLE ada.integration_account
  ADD CONSTRAINT integration_account_sending_policy
  CHECK (sending_enabled = false OR (
    kind = 'email_graph' AND config->>'auth_mode' = 'app_only'
  ));

CREATE TABLE ada.email_draft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ada.integration_account(id),
  unit_id integer NOT NULL,
  author_user_id integer NOT NULL,
  recipients jsonb NOT NULL CHECK (jsonb_typeof(recipients)='array'),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body_enc text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sending','submitted','failed')),
  submitted_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_draft_author_idx
  ON ada.email_draft(unit_id,author_user_id,created_at DESC);
