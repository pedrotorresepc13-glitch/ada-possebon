-- Configuração de IA exclusiva da ADA. Nunca gravar chaves em texto claro.
CREATE TABLE ada.ai_provider_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider text NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
  model text NOT NULL,
  api_key_enc text,
  timeout_ms integer NOT NULL DEFAULT 45000 CHECK (timeout_ms BETWEEN 5000 AND 120000),
  max_output_tokens integer NOT NULL DEFAULT 1500 CHECK (max_output_tokens BETWEEN 64 AND 16000),
  updated_by integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
