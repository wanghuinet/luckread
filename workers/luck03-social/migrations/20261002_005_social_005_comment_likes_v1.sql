-- MIG-SOCIAL-005-COMMENT-LIKES-V1
-- Logical authority: D1-02 / W05
-- Extend the existing like relationship authority to published comments.
-- Preserve all existing content-like rows while widening the target-type constraint.

CREATE TABLE IF NOT EXISTS interaction_likes_v2 (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'comment')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO interaction_likes_v2 (
  relationship_id,
  actor_user_id,
  target_type,
  target_id,
  created_at
)
SELECT
  relationship_id,
  actor_user_id,
  target_type,
  target_id,
  created_at
FROM interaction_likes;

DROP TABLE interaction_likes;

ALTER TABLE interaction_likes_v2 RENAME TO interaction_likes;

CREATE UNIQUE INDEX IF NOT EXISTS uq_interaction_like_actor_target
  ON interaction_likes (actor_user_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS ix_interaction_like_target_created
  ON interaction_likes (target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS ix_interaction_like_actor_created
  ON interaction_likes (actor_user_id, created_at);
