BEGIN;

CREATE SCHEMA posso_integration;
REVOKE ALL ON SCHEMA posso_integration FROM PUBLIC;

CREATE TABLE posso_integration.outbox_position (
    singleton boolean PRIMARY KEY CHECK (singleton),
    sequence bigint NOT NULL CHECK (sequence >= 0)
);
INSERT INTO posso_integration.outbox_position VALUES (true, 0);

CREATE TABLE posso_integration.change_outbox (
    sequence bigint PRIMARY KEY,
    event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object')
);

CREATE FUNCTION posso_integration.publish_change(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    position bigint;
BEGIN
    IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR pg_column_size(payload) > 65536 THEN
        RAISE EXCEPTION 'Invalid POSSEBON event payload';
    END IF;
    -- O bloqueio da linha permanece até o commit da alteração original.
    UPDATE posso_integration.outbox_position
    SET sequence = sequence + 1 WHERE singleton
    RETURNING sequence INTO STRICT position;
    INSERT INTO posso_integration.change_outbox(sequence, event) VALUES (position, payload);
    RETURN position;
END;
$$;

REVOKE ALL ON FUNCTION posso_integration.publish_change(jsonb) FROM PUBLIC;

CREATE FUNCTION posso_integration.capture_monitored_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    current_row jsonb := to_jsonb(NEW);
    previous_row jsonb;
    fields jsonb := '{}'::jsonb;
    previous_fields jsonb := '{}'::jsonb;
    field text;
    record_key text;
    unit_id text;
    i integer;
BEGIN
    IF TG_OP NOT IN ('INSERT', 'UPDATE') OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'AFTER'
        OR TG_NARGS < 4 OR TG_ARGV[0] !~ '^[a-z][a-z0-9_.]{1,80}$' THEN
        RAISE EXCEPTION 'Invalid POSSEBON capture configuration';
    END IF;
    record_key := current_row->>TG_ARGV[1];
    unit_id := current_row->>TG_ARGV[2];
    IF record_key IS NULL OR char_length(record_key) NOT BETWEEN 1 AND 120
        OR unit_id IS NULL OR unit_id !~ '^[1-9][0-9]{0,8}$' THEN
        RAISE EXCEPTION 'Invalid POSSEBON record key or unit';
    END IF;
    IF TG_OP = 'UPDATE' THEN previous_row := to_jsonb(OLD); END IF;
    FOR i IN 1..TG_NARGS-1 LOOP
        field := TG_ARGV[i];
        IF field !~ '^[a-z][a-z0-9_]{0,62}$' OR NOT current_row ? field
            OR field ~ '(senha|password|passwd|secret|token|credential|cpf|cnpj|email|telefone|celular|biometria)' THEN
            RAISE EXCEPTION 'Invalid POSSEBON capture field';
        END IF;
        fields := fields || jsonb_build_object(field, current_row->field);
        IF previous_row IS NOT NULL THEN
            previous_fields := previous_fields || jsonb_build_object(field, previous_row->field);
        END IF;
    END LOOP;
    IF previous_row IS NOT NULL AND fields = previous_fields THEN RETURN NULL; END IF;
    IF TG_ARGV[0] = 'possebon.operational' THEN
        IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME !~ '^[a-z][a-z0-9_]{0,62}$' THEN
            RAISE EXCEPTION 'Invalid POSSEBON operational table';
        END IF;
        fields := jsonb_build_object('table', TG_TABLE_NAME);
    END IF;
    PERFORM posso_integration.publish_change(jsonb_build_object(
        'source', TG_ARGV[0], 'eventId', gen_random_uuid()::text,
        'recordKey', record_key, 'unitId', unit_id::integer,
        'occurredAt', statement_timestamp(), 'record', fields
    ));
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION posso_integration.capture_monitored_row() FROM PUBLIC;

COMMIT;
