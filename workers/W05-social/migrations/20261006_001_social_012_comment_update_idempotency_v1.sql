-- MIG-SOCIAL-012-COMMENT-UPDATE-IDEMPOTENCY-V1
-- Logical authority: D1-02 / W05
-- Persist comment-edit replay responses and fail closed if the guarded
-- optimistic update changes zero rows.

CREATE TABLE social_comment_mutation_idempotency (
  id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(actor_user_id, operation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_social_comment_mutation_idem_expiry
  ON social_comment_mutation_idempotency(expires_at);

CREATE TABLE social_comment_txn_guard (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  successful INTEGER NOT NULL CHECK (successful = 1)
);
