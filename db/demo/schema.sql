-- ============================================================================
-- DADOS EXCLUSIVAMENTE SINTÉTICOS PARA DEMONSTRAÇÃO E TESTES DA ADA.
-- Nunca representam a POSSEBON. Este schema é recusado quando ADA_ENV=production.
-- ============================================================================
DROP SCHEMA IF EXISTS ada_demo CASCADE;
CREATE SCHEMA ada_demo;
COMMENT ON SCHEMA ada_demo IS 'SINTÉTICO — dados fictícios de demonstração da ADA. Não usar em produção.';

CREATE TABLE ada_demo.unidade (
  id        integer PRIMARY KEY,
  nome      text NOT NULL
);

CREATE TABLE ada_demo.equipe (
  id        integer PRIMARY KEY,
  unit_id   integer NOT NULL REFERENCES ada_demo.unidade(id),
  nome      text NOT NULL,
  gerencia  text NOT NULL
);

CREATE TABLE ada_demo.efetivo_diario (
  id        serial PRIMARY KEY,
  unit_id   integer NOT NULL REFERENCES ada_demo.unidade(id),
  equipe_id integer NOT NULL REFERENCES ada_demo.equipe(id),
  data      date NOT NULL,
  presentes integer NOT NULL CHECK (presentes >= 0),
  previsto  integer NOT NULL CHECK (previsto >= 0),
  UNIQUE (equipe_id, data)
);
CREATE INDEX efetivo_unit_data_idx ON ada_demo.efetivo_diario (unit_id, data);

CREATE TABLE ada_demo.treinamento (
  id              serial PRIMARY KEY,
  unit_id         integer NOT NULL REFERENCES ada_demo.unidade(id),
  equipe_id       integer NOT NULL REFERENCES ada_demo.equipe(id),
  tema            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('concluido', 'pendente')),
  data_conclusao  date NOT NULL
);

CREATE TABLE ada_demo.os (
  os_id                 integer PRIMARY KEY,
  unit_id               integer NOT NULL REFERENCES ada_demo.unidade(id),
  titulo                text NOT NULL,
  status                text NOT NULL CHECK (status IN ('aberta', 'em_execucao', 'aguardando_material', 'concluida', 'cancelada')),
  prazo_previsto        timestamptz,
  responsavel           text NOT NULL,
  percentual_concluido  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL
);
CREATE INDEX os_unit_updated_idx ON ada_demo.os (unit_id, updated_at);

CREATE TABLE ada_demo.solicitacao_compra (
  id        serial PRIMARY KEY,
  unit_id   integer NOT NULL REFERENCES ada_demo.unidade(id),
  data      date NOT NULL,
  status    text NOT NULL CHECK (status IN ('aberta', 'em_cotacao', 'aprovada', 'recebida', 'cancelada')),
  categoria text NOT NULL,
  valor     numeric(14, 2) NOT NULL
);
