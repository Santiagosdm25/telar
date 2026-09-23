-- llm_providers existía desde 001_init.sql pero ningún código la usaba: el
-- modelo se elegía con una sola variable global (DEFAULT_MODEL). Esto la
-- conecta: cada cuenta puede tener como mucho un proveedor activo a la vez,
-- que es el que usa el compilador del grafo para esa cuenta.

ALTER TABLE llm_providers ADD COLUMN is_active boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX llm_providers_one_active_per_account
    ON llm_providers (account_id) WHERE is_active;
