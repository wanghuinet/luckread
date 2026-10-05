-- MIG-SOCIAL-003-LIKE-V1
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
