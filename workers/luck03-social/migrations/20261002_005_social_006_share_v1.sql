-- MIG-SOCIAL-006-SHARE-V1
-- Logical authority: D1-02 / W05
-- Share tokens are opaque, content-scoped and retry-safe per actor/idempotency key.

CREATE TABLE IF NOT EXISTS social_share_links (
  share_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_social_share_links_content_created
  ON social_share_links (content_id, created_at);

CREATE INDEX IF NOT EXISTS ix_social_share_links_actor_created
  ON social_share_links (actor_user_id, created_at);
