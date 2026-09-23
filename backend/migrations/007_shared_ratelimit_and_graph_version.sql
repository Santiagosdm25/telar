-- Estado compartido entre procesos/réplicas -- antes vivía solo en memoria
-- (agent/graph_cache.py, core/ratelimit.py), invisible con un solo proceso
-- pero incorrecto en cuanto se corre más de uno.

-- account_graph_versions: no guarda el grafo compilado (no es serializable,
-- trae modelos ya enlazados) -- guarda de qué versión es. Cada proceso
-- sigue compilando y cacheando localmente, pero compara contra esta
-- versión en cada uso; si no coincide, recompila.
CREATE TABLE account_graph_versions (
    account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    version    bigint NOT NULL DEFAULT 1
);

-- rate_limit_counters: ventana fija atómica (no ventana deslizante como la
-- versión en memoria) -- un INSERT ... ON CONFLICT DO UPDATE por evento,
-- sin lock explícito, correcto sin importar cuántos procesos lo compartan.
CREATE TABLE rate_limit_counters (
    key          text NOT NULL,
    window_start timestamptz NOT NULL,
    count        integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);
