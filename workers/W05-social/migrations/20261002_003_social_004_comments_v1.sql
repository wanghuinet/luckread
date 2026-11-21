-- MIG-SOCIAL-004-COMMENTS-V1
-- Logical authority: D1-02 / W05
-- 1.0 comment creation and bounded comment-thread reads.

CREATE TABLE IF NOT EXISTS social_comments (
  id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  parent_id TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  state TEXT NOT NULL CHECK (state IN ('PENDING','PUBLISHED','REJECTED')),
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 3),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(author_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_social_comments_content_state_created
  ON social_comments (content_id, state, created_at, id);

CREATE INDEX IF NOT EXISTS ix_social_comments_parent_created
  ON social_comments (parent_id, created_at, id);

CREATE INDEX IF NOT EXISTS ix_social_comments_author_created
  ON social_comments (author_user_id, created_at, id);
