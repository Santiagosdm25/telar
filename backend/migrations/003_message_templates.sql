-- Registro de plantillas de Meta ya aprobadas en Meta Business Manager.
-- Telar no crea plantillas en Meta -- eso se hace en su consola -- esto
-- solo guarda cuál usar y con qué componentes, para poder enviarlas fuera
-- de la ventana de servicio de 24h (ver core/state.py window_is_open).

CREATE TABLE message_templates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        text NOT NULL,
    language    text NOT NULL DEFAULT 'es',
    components  jsonb NOT NULL DEFAULT '[]',
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, name, language)
);
