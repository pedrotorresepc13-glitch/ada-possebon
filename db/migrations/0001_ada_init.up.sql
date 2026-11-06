-- ADA POSSEBON — schema inicial dedicado.
-- Nada é criado no schema public nem nas tabelas de controle do MAD Builder.
-- Timestamps em UTC (timestamptz); conversão para America/Sao_Paulo somente na apresentação.

CREATE SCHEMA IF NOT EXISTS ada;

-- ---------------------------------------------------------------- identidade e sessão
CREATE TABLE ada.user_identity_map (
  system_user_id   integer PRIMARY KEY,
  login            text NOT NULL,
  display_name     text NOT NULL,
  identity_source  text NOT NULL CHECK (identity_source IN ('possebon', 'dev_synthetic')),
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.user_session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       text NOT NULL UNIQUE,
  csrf_token       text NOT NULL,
  system_user_id   integer NOT NULL REFERENCES ada.user_identity_map(system_user_id),
  active_unit_id   integer NOT NULL,
  identity_source  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  idle_expires_at  timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_reason   text,
  user_agent       text
);
CREATE INDEX user_session_user_idx ON ada.user_session (system_user_id) WHERE revoked_at IS NULL;

-- Proteção contra replay de tickets SSO (uso único).
CREATE TABLE ada.sso_ticket_use (
  jti              text PRIMARY KEY,
  system_user_id   integer NOT NULL,
  used_at          timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);

CREATE TABLE ada.permission_cache (
  system_user_id       integer NOT NULL,
  unit_id              integer NOT NULL,
  context              jsonb NOT NULL,
  permissions_version  text NOT NULL,
  resolved_at          timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  PRIMARY KEY (system_user_id, unit_id)
);

-- ---------------------------------------------------------------- memória privada do usuário
CREATE TABLE ada.conversation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    integer NOT NULL,
  unit_id          integer NOT NULL,
  title            text NOT NULL DEFAULT 'Nova conversa',
  draft_dashboard  jsonb,
  dashboard_id     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  deleted_at       timestamptz
);
CREATE INDEX conversation_owner_idx ON ada.conversation (owner_user_id, unit_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE ada.message (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES ada.conversation(id) ON DELETE CASCADE,
  owner_user_id    integer NOT NULL,
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system_note')),
  content_enc      text NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_conversation_idx ON ada.message (conversation_id, created_at);

CREATE TABLE ada.user_memory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    integer NOT NULL,
  unit_id          integer,
  kind             text NOT NULL CHECK (kind IN ('preferencia', 'fato_pessoal', 'resumo')),
  content_enc      text NOT NULL,
  sensitivity      text NOT NULL DEFAULT 'interno' CHECK (sensitivity IN ('publico', 'interno', 'restrito', 'confidencial')),
  origin           text NOT NULL DEFAULT 'usuario' CHECK (origin IN ('usuario', 'conversa')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX user_memory_owner_idx ON ada.user_memory (owner_user_id) WHERE deleted_at IS NULL;

CREATE TABLE ada.user_preference (
  owner_user_id    integer PRIMARY KEY,
  prefs            jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- conhecimento empresarial
CREATE TABLE ada.knowledge_source (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN ('upload', 'url', 'possebon_brain', 'email', 'manual')),
  name               text NOT NULL,
  uri                text,
  scope              text NOT NULL CHECK (scope IN ('global', 'unidade', 'dominio')),
  unit_id            integer,
  domain             text,
  sensitivity        text NOT NULL DEFAULT 'interno' CHECK (sensitivity IN ('publico', 'interno', 'restrito', 'confidencial')),
  required_programs  text[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'pausado', 'erro', 'nao_configurado')),
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_sync_at       timestamptz,
  last_error         text,
  CHECK (scope <> 'unidade' OR unit_id IS NOT NULL),
  CHECK (scope <> 'dominio' OR domain IS NOT NULL)
);

CREATE TABLE ada.knowledge_document (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          uuid NOT NULL REFERENCES ada.knowledge_source(id) ON DELETE CASCADE,
  title              text NOT NULL,
  mime_type          text NOT NULL,
  original_name      text,
  size_bytes         integer NOT NULL DEFAULT 0,
  checksum           text NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'processando', 'revisando', 'indexado', 'erro', 'rejeitado')),
  scope              text NOT NULL CHECK (scope IN ('global', 'unidade', 'dominio')),
  unit_id            integer,
  domain             text,
  sensitivity        text NOT NULL DEFAULT 'interno',
  required_programs  text[] NOT NULL DEFAULT '{}',
  valid_until        date,
  injection_flags    jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_content        bytea,
  extracted_text     text,
  error              text,
  observed_at        timestamptz NOT NULL DEFAULT now(),
  created_by         integer NOT NULL,
  reviewed_by        integer,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, checksum)
);
CREATE INDEX knowledge_document_status_idx ON ada.knowledge_document (status, created_at);

CREATE TABLE ada.knowledge_chunk (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        uuid NOT NULL REFERENCES ada.knowledge_document(id) ON DELETE CASCADE,
  ordinal            integer NOT NULL,
  content            text NOT NULL,
  tsv                tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  UNIQUE (document_id, ordinal)
);
CREATE INDEX knowledge_chunk_tsv_idx ON ada.knowledge_chunk USING gin (tsv);

CREATE TABLE ada.knowledge_relation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_document_id   uuid NOT NULL REFERENCES ada.knowledge_document(id) ON DELETE CASCADE,
  to_document_id     uuid NOT NULL REFERENCES ada.knowledge_document(id) ON DELETE CASCADE,
  relation           text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.knowledge_sync_run (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          uuid REFERENCES ada.knowledge_source(id) ON DELETE CASCADE,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  status             text NOT NULL CHECK (status IN ('executando', 'ok', 'erro')),
  stats              jsonb NOT NULL DEFAULT '{}'::jsonb,
  error              text
);

-- ---------------------------------------------------------------- catálogo semântico e conectores
CREATE TABLE ada.semantic_entity (
  id                 text PRIMARY KEY,
  label              text NOT NULL,
  source_id          text NOT NULL,
  description        text NOT NULL DEFAULT '',
  status             text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.semantic_metric (
  id                 text PRIMARY KEY,
  label              text NOT NULL,
  description        text NOT NULL,
  formula            text NOT NULL,
  source_id          text NOT NULL,
  unit               text NOT NULL,
  status             text NOT NULL CHECK (status IN ('validado', 'sintetico', 'rascunho_nao_validado')),
  sensitivity        text NOT NULL,
  required_programs  text[] NOT NULL DEFAULT '{}',
  dimensions         text[] NOT NULL DEFAULT '{}',
  definition_hash    text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.semantic_dimension (
  id                 text PRIMARY KEY,
  label              text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('time', 'category')),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.source_connector (
  id                 text PRIMARY KEY,
  kind               text NOT NULL,
  label              text NOT NULL,
  status             text NOT NULL CHECK (status IN ('nao_configurado', 'configurado_nao_validado', 'ativo', 'degradado', 'erro', 'desabilitado', 'demonstracao')),
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc         text,
  allowed_operations text[] NOT NULL DEFAULT '{}',
  allowed_units      integer[] NOT NULL DEFAULT '{}',
  watermark          text,
  last_check_at      timestamptz,
  last_error         text,
  updated_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- dashboards
CREATE TABLE ada.dashboard (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      integer NOT NULL,
  unit_id            integer NOT NULL,
  title              text NOT NULL,
  description        text NOT NULL DEFAULT '',
  spec               jsonb NOT NULL,
  current_revision   integer NOT NULL DEFAULT 1,
  share_policy       text NOT NULL DEFAULT 'privado' CHECK (share_policy IN ('privado', 'compartilhado')),
  sources            text[] NOT NULL DEFAULT '{}',
  metrics            text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at  timestamptz,
  deleted_at         timestamptz
);
CREATE INDEX dashboard_owner_idx ON ada.dashboard (owner_user_id, unit_id) WHERE deleted_at IS NULL;

CREATE TABLE ada.dashboard_revision (
  dashboard_id       uuid NOT NULL REFERENCES ada.dashboard(id) ON DELETE CASCADE,
  revision           integer NOT NULL,
  spec               jsonb NOT NULL,
  change_summary     text NOT NULL DEFAULT '',
  created_by         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dashboard_id, revision)
);

CREATE TABLE ada.dashboard_share (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id       uuid NOT NULL REFERENCES ada.dashboard(id) ON DELETE CASCADE,
  target_type        text NOT NULL CHECK (target_type IN ('unit', 'group', 'user')),
  target_id          integer NOT NULL,
  unit_id            integer NOT NULL,
  created_by         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dashboard_id, target_type, target_id)
);

-- Cache curto de resultados, sempre por usuário + unidades + versão de permissões + parâmetros.
CREATE TABLE ada.query_cache (
  cache_key          text PRIMARY KEY,
  owner_user_id      integer NOT NULL,
  payload            jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL
);
CREATE INDEX query_cache_owner_idx ON ada.query_cache (owner_user_id);

-- ---------------------------------------------------------------- monitores determinísticos
CREATE TABLE ada.monitor_rule (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        integer NOT NULL,
  unit_id              integer NOT NULL,
  name                 text NOT NULL,
  source_id            text NOT NULL,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'degraded', 'deleted')),
  current_revision     integer NOT NULL DEFAULT 1,
  definition           jsonb NOT NULL,
  check_every_minutes  integer NOT NULL CHECK (check_every_minutes BETWEEN 1 AND 1440),
  dashboard_id         uuid REFERENCES ada.dashboard(id) ON DELETE SET NULL,
  watermark            text,
  next_run_at          timestamptz,
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  health               text NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'degradado', 'erro')),
  last_error           text,
  activated_at         timestamptz,
  lease_owner          text,
  lease_until          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE INDEX monitor_rule_due_idx ON ada.monitor_rule (next_run_at) WHERE status IN ('active', 'degraded') AND deleted_at IS NULL;
CREATE INDEX monitor_rule_owner_idx ON ada.monitor_rule (owner_user_id, unit_id) WHERE deleted_at IS NULL;

CREATE TABLE ada.monitor_revision (
  monitor_id         uuid NOT NULL REFERENCES ada.monitor_rule(id) ON DELETE CASCADE,
  revision           integer NOT NULL,
  definition         jsonb NOT NULL,
  change_summary     text NOT NULL DEFAULT '',
  created_by         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (monitor_id, revision)
);

CREATE TABLE ada.monitor_run (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id         uuid NOT NULL REFERENCES ada.monitor_rule(id) ON DELETE CASCADE,
  trigger_kind       text NOT NULL CHECK (trigger_kind IN ('agendado', 'evento', 'teste')),
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  status             text NOT NULL CHECK (status IN ('executando', 'ok', 'sem_mudancas', 'fonte_indisponivel', 'erro')),
  records_checked    integer NOT NULL DEFAULT 0,
  events_created     integer NOT NULL DEFAULT 0,
  ai_calls           integer NOT NULL DEFAULT 0,
  error              text
);
CREATE INDEX monitor_run_monitor_idx ON ada.monitor_run (monitor_id, started_at DESC);

CREATE TABLE ada.monitor_watermark (
  monitor_id         uuid NOT NULL REFERENCES ada.monitor_rule(id) ON DELETE CASCADE,
  record_key         text NOT NULL,
  snapshot           jsonb NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (monitor_id, record_key)
);

CREATE TABLE ada.monitor_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id         uuid NOT NULL REFERENCES ada.monitor_rule(id) ON DELETE CASCADE,
  record_key         text NOT NULL,
  dedupe_key         text NOT NULL,
  trigger_type       text NOT NULL,
  status             text NOT NULL CHECK (status IN ('notificado', 'suprimido')),
  severity           text NOT NULL,
  title              text NOT NULL,
  body               text NOT NULL,
  evidence           jsonb NOT NULL,
  occurred_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (monitor_id, dedupe_key)
);

-- Eventos recebidos por webhook/outbox (idempotentes por source + event_id).
CREATE TABLE ada.inbound_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text NOT NULL,
  event_id           text NOT NULL,
  record_key         text NOT NULL,
  unit_id            integer NOT NULL,
  occurred_at        timestamptz NOT NULL,
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  UNIQUE (source_id, event_id)
);
CREATE INDEX inbound_event_pending_idx ON ada.inbound_event (received_at) WHERE processed_at IS NULL;

-- ---------------------------------------------------------------- notificações
CREATE TABLE ada.notification (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id  integer NOT NULL,
  unit_id            integer NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('info', 'aviso', 'critico')),
  title              text NOT NULL,
  body               text NOT NULL,
  source_id          text,
  monitor_id         uuid REFERENCES ada.monitor_rule(id) ON DELETE SET NULL,
  monitor_event_id   uuid REFERENCES ada.monitor_event(id) ON DELETE SET NULL,
  dashboard_id       uuid REFERENCES ada.dashboard(id) ON DELETE SET NULL,
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  read_at            timestamptz,
  acknowledged_at    timestamptz,
  UNIQUE (recipient_user_id, dedupe_key)
);
CREATE INDEX notification_recipient_idx ON ada.notification (recipient_user_id, created_at DESC);

CREATE TABLE ada.notification_delivery (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id    uuid NOT NULL REFERENCES ada.notification(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  status             text NOT NULL CHECK (status IN ('entregue', 'pendente', 'falhou', 'nao_configurado')),
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at       timestamptz
);

-- ---------------------------------------------------------------- integrações (e-mail etc.)
CREATE TABLE ada.integration_account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN ('email_imap', 'email_gmail', 'email_graph')),
  label              text NOT NULL,
  unit_id            integer NOT NULL,
  allowed_user_ids   integer[] NOT NULL DEFAULT '{}',
  allowed_group_ids  integer[] NOT NULL DEFAULT '{}',
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc         text,
  status             text NOT NULL DEFAULT 'nao_configurado' CHECK (status IN ('nao_configurado', 'configurado_nao_validado', 'ativo', 'degradado', 'erro', 'desabilitado')),
  -- Envio externo desabilitado nesta versão: exige ação futura com rascunho + confirmação.
  sending_enabled    boolean NOT NULL DEFAULT false CHECK (sending_enabled = false),
  last_test_at       timestamptz,
  last_test_result   text,
  last_sync_at       timestamptz,
  watermark          text,
  created_by         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

-- ---------------------------------------------------------------- IA, configurações, auditoria e operação
CREATE TABLE ada.app_setting (
  key                text PRIMARY KEY,
  value              jsonb NOT NULL,
  updated_by         integer,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.ai_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            integer,
  unit_id            integer,
  provider           text NOT NULL,
  model              text NOT NULL,
  purpose            text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  status             text NOT NULL,
  latency_ms         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_user_day_idx ON ada.ai_usage (user_id, created_at);

CREATE TABLE ada.audit_event (
  id                 bigserial PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  actor_user_id      integer,
  unit_id            integer,
  action             text NOT NULL,
  target_type        text,
  target_id          text,
  outcome            text NOT NULL CHECK (outcome IN ('ok', 'negado', 'erro')),
  details            jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_event_time_idx ON ada.audit_event (occurred_at DESC);

-- Trilha de auditoria imutável: nem o serviço pode alterar ou apagar registros.
CREATE FUNCTION ada.audit_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ada.audit_event é somente inserção';
END;
$$;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON ada.audit_event
  FOR EACH ROW EXECUTE FUNCTION ada.audit_event_immutable();

CREATE TABLE ada.worker_heartbeat (
  worker_id          text PRIMARY KEY,
  started_at         timestamptz NOT NULL,
  last_beat_at       timestamptz NOT NULL,
  info               jsonb NOT NULL DEFAULT '{}'::jsonb
);
