-- Memoria CORPORATIVA separada da memoria pessoal e do Brain de estruturas.
-- Fatos produzidos por IA trazem trecho de evidencia documental, escopo e revisao.
-- Dados operacionais permanecem no POSSEBON Web; nao fazer dump de colaboradores.
CREATE TABLE ada.corporate_study_progress (
  document_id uuid PRIMARY KEY REFERENCES ada.knowledge_document(id) ON DELETE CASCADE,
  source_checksum text NOT NULL,
  next_ordinal integer NOT NULL DEFAULT 0 CHECK (next_ordinal >= 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','partial','complete','error')),
  facts_extracted integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ada.corporate_fact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ada.knowledge_document(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES ada.knowledge_chunk(id) ON DELETE CASCADE,
  source_checksum text NOT NULL,
  fact_hash text NOT NULL UNIQUE,
  unit_id integer,
  required_programs text[] NOT NULL DEFAULT '{}'::text[],
  sensitivity text NOT NULL DEFAULT 'interno',
  topic text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'empresa','consorcio','cliente','empreendimento','contrato',
    'objetivo','escopo','obrigacao','prazo','processo','andamento',
    'pendencia','risco','melhoria','outro')),
  statement_enc text NOT NULL,
  evidence_enc text NOT NULL,
  certainty text NOT NULL CHECK (certainty IN ('documental','hipotese')),
  review_state text NOT NULL DEFAULT 'sugerido'
    CHECK (review_state IN ('sugerido','validado','rejeitado')),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_fact_access_idx ON ada.corporate_fact (unit_id,category,review_state);
CREATE INDEX corporate_fact_document_idx ON ada.corporate_fact (document_id,source_checksum);
