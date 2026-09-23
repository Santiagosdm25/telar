-- Habilita las tools configurables (http, sql) de la cuenta.
-- config sigue en jsonb, legible (URL, método, query template...).
-- secret_config guarda cifrado con Fernet solo la parte sensible (headers
-- de auth, connection string), mismo patrón que inboxes.credentials y
-- llm_providers.api_key.

ALTER TABLE tools ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tools ADD COLUMN secret_config bytea;
