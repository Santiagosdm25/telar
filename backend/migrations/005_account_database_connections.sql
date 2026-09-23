-- Conexión a la base de datos externa (Postgres o MySQL) que cada cuenta
-- puede traer para operar sus propios datos -- ver telar/tenant_db/ para
-- el aprovisionamiento de las 3 tablas relacionadas (roles, usuarios,
-- contactos, conversaciones) dentro de esa base.
--
-- v0: una sola conexión por cuenta. Todavía no reemplaza la Postgres
-- compartida donde vive el resto de Telar (auth, checkpoints de
-- LangGraph, kb vectorial) -- esto es la base que el cliente trae para su
-- propio negocio, aparte, no un swap del motor interno.

CREATE TABLE account_database_connections (
    account_id      uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    engine          text NOT NULL CHECK (engine IN ('postgres', 'mysql')),
    host            text NOT NULL,
    port            integer NOT NULL,
    database_name   text NOT NULL,
    username        text NOT NULL,
    password        bytea NOT NULL,
    use_ssl         boolean NOT NULL DEFAULT true,
    status          text NOT NULL DEFAULT 'disconnected'
                        CHECK (status IN ('disconnected', 'connected', 'provisioned', 'error')),
    last_error      text,
    provisioned_at  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
