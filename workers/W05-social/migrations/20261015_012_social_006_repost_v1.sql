-- SOCIAL-006 REPOST RELATION
-- Authority: W05 / D1-02. One row per actor and canonical original content.
-- Content body and media are referenced by content_id, never copied.
CREATE TABLE IF NOT EXISTS social_reposts (
  repost_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id, content_id)
);

CREATE INDEX IF NOT EXISTS ix_social_reposts_content_created
  ON social_reposts (content_id, created_at, repost_id);

CREATE INDEX IF NOT EXISTS ix_social_reposts_actor_created
  ON social_reposts (actor_user_id, created_at, repost_id);
