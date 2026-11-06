-- Executar no banco operacional, como DBA, com psql -v posso_role=ROLE_DE_LEITURA.
BEGIN;
CREATE SCHEMA posso_read_access;
REVOKE ALL ON SCHEMA posso_read_access FROM PUBLIC;
CREATE TABLE posso_read_access.settings (reader name PRIMARY KEY);
INSERT INTO posso_read_access.settings SELECT rolname FROM pg_roles
WHERE rolname = :'posso_role' AND rolname <> 'public'
  AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM posso_read_access.settings) THEN
    RAISE EXCEPTION 'Informe uma role técnica existente sem privilégios administrativos.';
  END IF;
END;
$$;

CREATE FUNCTION posso_read_access.grant_new_business_table()
RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  target record;
  reader name;
BEGIN
  SELECT s.reader INTO STRICT reader FROM posso_read_access.settings s;
  FOR target IN
    SELECT DISTINCT c.oid, c.relname FROM pg_event_trigger_ddl_commands() command
    JOIN pg_class c ON command.classid = 'pg_class'::regclass AND command.objid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT command.in_extension
      AND c.relname ~ '^[a-z][a-z0-9_]{0,62}$'
      AND c.relname !~* '^(system_|ada_|log_|audit_|migration|pg_|auth|oauth|session|sso_|user_session|users?$|usuarios?$|usuario_senha|senha|credential|credencial|token|password|api_key|permission|permissao|perfil_acesso)'
  LOOP
    IF NOT has_table_privilege(reader, target.oid, 'SELECT') THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I', target.relname, reader);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION posso_read_access.grant_new_business_table() FROM PUBLIC;

CREATE EVENT TRIGGER posso_read_new_business_table ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION posso_read_access.grant_new_business_table();
COMMIT;
