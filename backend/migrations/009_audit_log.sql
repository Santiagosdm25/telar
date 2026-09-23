CREATE TABLE audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   uuid,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_account_created ON audit_log (account_id, created_at DESC);
