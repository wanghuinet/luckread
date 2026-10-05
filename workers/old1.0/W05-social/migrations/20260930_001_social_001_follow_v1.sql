-- MIG-SOCIAL-001-FOLLOW-V1
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
