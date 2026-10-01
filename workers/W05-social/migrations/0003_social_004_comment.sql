-- SOCIAL-004 Comment / Reply logical persistence
-- Controlled-manual migration only. No remote execution is implied by this file.

CREATE TABLE IF NOT EXISTS social_comments (
  comment_id TEXT PRIMARY KEY NOT NULL,
  author_user_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  parent_comment_id TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  state TEXT NOT NULL CHECK (state IN (
    'PENDING',
    'VISIBLE',
    'HIDDEN',
    'FLAGGED',
    'UNDER_REVIEW',
    'REJECTED',
    'DELETED',
    'AUTHOR_DELETED'
  )),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_social_comments_content_created
  ON social_comments (content_id, created_at);

CREATE INDEX IF NOT EXISTS ix_social_comments_content_parent_created
  ON social_comments (content_id, parent_comment_id, created_at);

CREATE INDEX IF NOT EXISTS ix_social_comments_author_created
  ON social_comments (author_user_id, created_at);
