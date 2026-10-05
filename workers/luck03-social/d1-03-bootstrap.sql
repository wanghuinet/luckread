-- LuckRead 1.1 D1-03 bootstrap: Social schema assembled from existing 1.0 migrations.
-- Apply once to the D1-03 target before data cutover.\n\n-- MIG-SOCIAL-001-FOLLOW-V1
-- Contract: contracts/persistence/SOCIAL-001-follow-relationship-migration-contract.v1.json
-- Authority: SOCIAL-001 -> T11 -> W05 -> D1-02
-- Execution is controlled by the admitted W05/D1-02 binding and migration gate.

CREATE TABLE IF NOT EXISTS social_follow_relationships (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  follower_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_follow_follower_target
  ON social_follow_relationships (follower_user_id, target_user_id);

CREATE INDEX IF NOT EXISTS ix_social_follow_follower_created
  ON social_follow_relationships (follower_user_id, created_at);

CREATE INDEX IF NOT EXISTS ix_social_follow_target_created
  ON social_follow_relationships (target_user_id, created_at);
\n\n-- MIG-SOCIAL-003-LIKE-V1
-- Logical authority: D1-02 / W05
-- One effective like per actor/target/target type.

CREATE TABLE IF NOT EXISTS interaction_likes (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'content'),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interaction_like_actor_target
  ON interaction_likes (actor_user_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS ix_interaction_like_target_created
  ON interaction_likes (target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS ix_interaction_like_actor_created
  ON interaction_likes (actor_user_id, created_at);
\n\n-- MIG-SOCIAL-004-COMMENTS-V1
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
\n\n-- MIG-SOCIAL-005-FAVORITE-V1
-- Logical authority: D1-02 / W05
-- One effective bookmark/favorite per actor/target/target type.

CREATE TABLE IF NOT EXISTS interaction_favorites (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'content'),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interaction_favorite_actor_target
  ON interaction_favorites (actor_user_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS ix_interaction_favorite_actor_created
  ON interaction_favorites (actor_user_id, created_at);

CREATE INDEX IF NOT EXISTS ix_interaction_favorite_target_created
  ON interaction_favorites (target_type, target_id, created_at);
\n\n-- MIG-SOCIAL-006-SHARE-V1
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
\n\n-- MIG-SOCIAL-009-BLOCK-MUTE-V1
-- Logical authority: D1-02 / W05
-- Block and mute are independent relationship types.

CREATE TABLE IF NOT EXISTS social_user_interactions (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('block','mute')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(actor_user_id, target_user_id, relation_type)
);

CREATE INDEX IF NOT EXISTS ix_social_user_interactions_actor_type_created
  ON social_user_interactions (actor_user_id, relation_type, created_at);

CREATE INDEX IF NOT EXISTS ix_social_user_interactions_target_type_created
  ON social_user_interactions (target_user_id, relation_type, created_at);
\n\n-- MIG-SOCIAL-010-COMMENT-DELETE-TOMBSTONE-V1
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
