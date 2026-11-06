-- Executar no banco que contém o cadastro do MAD Builder.
-- psql -v ON_ERROR_STOP=1 -v posso_role=ROLE_DE_LEITURA -f possebon-directory-read.sql
BEGIN;
SELECT set_config('posso.directory_reader', :'posso_role', true);
DO $$
DECLARE
  reader text := current_setting('posso.directory_reader');
  item record;
  fields text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=reader
    AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'Informe uma role técnica existente sem privilégios administrativos.';
  END IF;
  IF to_regclass('public.system_users') IS NULL THEN
    RAISE EXCEPTION 'Este banco não contém public.system_users.';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I',reader);
  FOR item IN SELECT c.oid,c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname IN ('system_users','system_group','system_program',
        'system_user_group','system_group_program','system_user_program',
        'system_user_unit','system_unit')
  LOOP
    SELECT string_agg(format('%I',attname),', ' ORDER BY attnum) INTO fields
      FROM pg_attribute WHERE attrelid=item.oid AND attnum>0 AND NOT attisdropped
        AND attname IN ('id','name','login','active','controller','actions',
          'system_user_id','system_group_id','system_program_id','system_unit_id');
    IF fields IS NOT NULL THEN
      EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO %I',fields,item.relname,reader);
    END IF;
  END LOOP;
END;
$$;
COMMIT;
