-- Cérebro corporativo: índice persistente de entidades e relações com proveniência e ACL.
-- Não guarda os registros operacionais do POSSEBON; eles continuam na fonte de verdade.
CREATE TABLE ada.brain_node (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('modelo','tabela','campo','area','tela','modulo','documento','parte')),
  label text NOT NULL,
  source_ref text NOT NULL,
  unit_id integer,
  required_programs text[] NOT NULL DEFAULT '{}',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brain_node_kind_idx ON ada.brain_node (kind,unit_id);
CREATE INDEX brain_node_label_idx ON ada.brain_node (lower(label));
CREATE TABLE ada.brain_edge (
  from_id text NOT NULL REFERENCES ada.brain_node(id) ON DELETE CASCADE,
  to_id text NOT NULL REFERENCES ada.brain_node(id) ON DELETE CASCADE,
  relation text NOT NULL CHECK (relation IN ('representa','possui_campo','contem_tela','contem_parte')),
  source_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id,to_id,relation)
);
CREATE INDEX brain_edge_to_idx ON ada.brain_edge (to_id);
