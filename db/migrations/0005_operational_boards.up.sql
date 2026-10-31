-- Telas dinâmicas declarativas; os dados permanecem somente no POSSEBON Web.
CREATE TABLE ada.operational_board (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id integer NOT NULL,
  unit_id integer NOT NULL,
  title text NOT NULL,
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX operational_board_owner_idx ON ada.operational_board(owner_user_id,unit_id,updated_at DESC) WHERE deleted_at IS NULL;
