-- Preparação privada retomável, compartilhamento declarativo e acompanhamento sem IA.
CREATE TABLE ada.personal_workspace (
  owner_user_id integer NOT NULL,
  unit_id integer NOT NULL,
  permission_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ready','partial','error')),
  step integer NOT NULL DEFAULT 0,
  tasks jsonb NOT NULL DEFAULT '[]',
  completed jsonb NOT NULL DEFAULT '[]',
  issues jsonb NOT NULL DEFAULT '[]',
  profile_enc text,
  live_board_id uuid REFERENCES ada.operational_board(id),
  dashboard_id uuid REFERENCES ada.dashboard(id),
  conversation_id uuid REFERENCES ada.conversation(id),
  welcomed_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_user_id,unit_id)
);
CREATE TABLE ada.operational_board_share (
  board_id uuid NOT NULL REFERENCES ada.operational_board(id) ON DELETE CASCADE,
  target_user_id integer NOT NULL,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(board_id,target_user_id)
);
CREATE TABLE ada.operational_watch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id integer NOT NULL,
  unit_id integer NOT NULL,
  name text NOT NULL,
  plan jsonb NOT NULL,
  snapshot_enc text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','error')),
  interval_minutes integer NOT NULL DEFAULT 5 CHECK(interval_minutes BETWEEN 1 AND 1440),
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,unit_id,name)
);
CREATE INDEX operational_watch_due_idx ON ada.operational_watch(next_check_at) WHERE state='active';
CREATE TABLE ada.work_reference (
  owner_user_id integer NOT NULL,
  unit_id integer NOT NULL,
  reference_key text NOT NULL,
  plan jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_user_id,unit_id,reference_key)
);
