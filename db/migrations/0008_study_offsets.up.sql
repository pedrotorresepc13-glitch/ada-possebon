-- Progresso de leitura parcial de trechos longos, sem reenviar a parte concluída.
ALTER TABLE ada.corporate_study_progress ADD COLUMN next_char_offset integer NOT NULL DEFAULT 0 CHECK(next_char_offset>=0);
