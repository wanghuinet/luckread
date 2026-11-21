-- MIG-SOCIAL-009-BLOCK-MUTE-V1
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
