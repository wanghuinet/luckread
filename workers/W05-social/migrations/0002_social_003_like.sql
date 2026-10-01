-- MIG-SOCIAL-003-LIKE-D1-02-V1
-- Contract: contracts/persistence/SOCIAL-003-like-d1-02-persistence.v1.json

CREATE TABLE IF NOT EXISTS social_like_relationships (
  like_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('content')),
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_like_actor_resource
  ON social_like_relationships (actor_user_id, resource_type, resource_id);

CREATE INDEX IF NOT EXISTS ix_social_like_resource_created
  ON social_like_relationships (resource_type, resource_id, created_at);

CREATE INDEX IF NOT EXISTS ix_social_like_actor_created
  ON social_like_relationships (actor_user_id, created_at);
