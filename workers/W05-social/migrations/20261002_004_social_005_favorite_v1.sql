-- MIG-SOCIAL-005-FAVORITE-V1
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
