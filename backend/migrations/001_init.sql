-- Esquema núcleo. Postgres 15+ con pgvector.
-- account_id va en todas las tablas aunque el v0 tenga una sola cuenta:
-- agregarlo después obliga a reescribir cada query del proyecto.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------- cuentas
CREATE TABLE accounts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    locale      text NOT NULL DEFAULT 'es',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- El superadmin no es otra aplicación ni otro dominio: es este flag.
CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext UNIQUE NOT NULL,
    name            text NOT NULL,
    password_hash   text NOT NULL,
    is_superadmin   boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE account_role AS ENUM ('administrator', 'supervisor', 'agent');

CREATE TABLE account_users (
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        account_role NOT NULL DEFAULT 'agent',
    PRIMARY KEY (account_id, user_id)
);

CREATE TABLE teams (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        text NOT NULL
);

CREATE TABLE team_members (
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
);

-- ---------------------------------------------------------------- canales
-- Un inbox = un número de WhatsApp. phone_number_id es la llave de
-- enrutamiento del webhook hacia la cuenta, el bot y la base de conocimiento.
CREATE TABLE inboxes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name                text NOT NULL,
    channel             text NOT NULL DEFAULT 'whatsapp',
    phone_number_id     text UNIQUE,
    waba_id             text,
    credentials         bytea,          -- token cifrado, nunca en claro
    webhook_verify_token text,
    bot_id              uuid,
    default_team_id     uuid REFERENCES teams(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inbox_members (
    inbox_id uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (inbox_id, user_id)
);

-- ---------------------------------------------------------------- contactos
CREATE TABLE contacts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    external_id     text NOT NULL,      -- wa_id
    name            text,
    phone           text,
    email           text,
    attributes      jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, external_id)
);

-- ---------------------------------------------------------------- conversaciones
CREATE TYPE conversation_status AS ENUM ('bot', 'pending', 'open', 'resolved');

CREATE TABLE conversations (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    inbox_id                uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    contact_id              uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    status                  conversation_status NOT NULL DEFAULT 'bot',
    assignee_id             uuid REFERENCES users(id),
    team_id                 uuid REFERENCES teams(id),
    bot_id                  uuid,
    last_contact_message_at timestamptz,
    resolved_at             timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- Una sola conversación viva por contacto e inbox.
CREATE UNIQUE INDEX one_live_conversation
    ON conversations (inbox_id, contact_id)
    WHERE status <> 'resolved';

CREATE INDEX conv_inbox_status ON conversations (inbox_id, status, created_at DESC);
CREATE INDEX conv_assignee ON conversations (assignee_id) WHERE assignee_id IS NOT NULL;

-- ---------------------------------------------------------------- mensajes
CREATE TYPE sender_type AS ENUM ('contact', 'bot', 'agent', 'system');

CREATE TABLE messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    inbox_id            uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    channel_message_id  text,
    sender_type         sender_type NOT NULL,
    sender_id           uuid,
    type                text NOT NULL DEFAULT 'text',
    content             text,
    media               jsonb,
    delivery_status     text NOT NULL DEFAULT 'pending',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Deduplicación del webhook: Meta reintenta y sin esto el bot responde doble.
CREATE UNIQUE INDEX message_dedup
    ON messages (inbox_id, channel_message_id)
    WHERE channel_message_id IS NOT NULL;

CREATE INDEX message_by_conversation ON messages (conversation_id, created_at);

-- ---------------------------------------------------------------- ajustes
CREATE TABLE labels (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title       text NOT NULL,
    color       text NOT NULL DEFAULT '#1F93FF',
    UNIQUE (account_id, title)
);

CREATE TABLE conversation_labels (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    label_id        uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, label_id)
);

CREATE TABLE canned_responses (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    short_code  text NOT NULL,
    content     text NOT NULL,
    UNIQUE (account_id, short_code)
);

CREATE TABLE custom_attribute_definitions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key             text NOT NULL,
    display_name    text NOT NULL,
    data_type       text NOT NULL DEFAULT 'text',
    applies_to      text NOT NULL DEFAULT 'contact',
    UNIQUE (account_id, key, applies_to)
);

-- ---------------------------------------------------------------- bots
CREATE TABLE bots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name                text NOT NULL,
    active_version_id   uuid,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- El canvas visual no es la fuente de verdad: este JSON sí.
-- El compilador lo traduce a un StateGraph de LangGraph.
CREATE TABLE bot_versions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id      uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    version     integer NOT NULL,
    graph       jsonb NOT NULL,     -- {nodes: [...], edges: [...]}
    notes       text,
    created_by  uuid REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bot_id, version)
);

CREATE TABLE llm_providers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        text NOT NULL,
    provider    text NOT NULL,      -- anthropic, openai, ollama, openrouter
    model       text NOT NULL,
    base_url    text,
    api_key     bytea,              -- cifrada
    params      jsonb NOT NULL DEFAULT '{}',
    UNIQUE (account_id, name)
);

CREATE TABLE tools (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text NOT NULL,
    kind        text NOT NULL,      -- http, sql, document
    config      jsonb NOT NULL DEFAULT '{}',
    schema      jsonb NOT NULL DEFAULT '{}',
    UNIQUE (account_id, name)
);

-- ---------------------------------------------------------------- knowledge
CREATE TABLE knowledge_bases (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        text NOT NULL,
    embedding_model text NOT NULL DEFAULT 'text-embedding-3-small',
    dimensions  integer NOT NULL DEFAULT 1536,
    UNIQUE (account_id, name)
);

CREATE TABLE kb_chunks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id   uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    source              text,
    content             text NOT NULL,
    metadata            jsonb NOT NULL DEFAULT '{}',
    embedding           vector(1536)
);

CREATE INDEX kb_chunks_vec ON kb_chunks
    USING hnsw (embedding vector_cosine_ops);
