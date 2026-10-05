-- MIG-SOCIAL-010-COMMENT-DELETE-TOMBSTONE-V1
-- Logical authority: D1-02 / W05
-- Preserve author-deleted comments as durable tombstones instead of hard-deleting rows.

CREATE TABLE social_comments_v2 (
  id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  parent_id TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  state TEXT NOT NULL CHECK (state IN ('PENDING','PUBLISHED','REJECTED','DELETED','AUTHOR_DELETED')),
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 3),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(author_user_id, idempotency_key)
);

INSERT INTO social_comments_v2 (
  id,
  content_id,
  author_user_id,
  parent_id,
  body,
  state,
  depth,
  idempotency_key,
  created_at,
  updated_at
)
SELECT
  id,
  content_id,
  author_user_id,
  parent_id,
  body,
  state,
  depth,
  idempotency_key,
  created_at,
  updated_at
FROM social_comments;

DROP TABLE social_comments;

ALTER TABLE social_comments_v2 RENAME TO social_comments;

CREATE INDEX IF NOT EXISTS ix_social_comments_content_state_created
  ON social_comments (content_id, state, created_at, id);

CREATE INDEX IF NOT EXISTS ix_social_comments_parent_created
  ON social_comments (parent_id, created_at, id);

CREATE INDEX IF NOT EXISTS ix_social_comments_author_created
  ON social_comments (author_user_id, created_at, id);
