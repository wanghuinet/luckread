-- SOCIAL-006 repost and creator profile pin relations
-- Authority: W05 / D1-02. Do not copy canonical content body or media.
CREATE TABLE IF NOT EXISTS social_reposts (
  repost_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id, content_id)
);
CREATE INDEX IF NOT EXISTS ix_social_reposts_content_created
  ON social_reposts (content_id, created_at, repost_id);
CREATE INDEX IF NOT EXISTS ix_social_reposts_actor_created
  ON social_reposts (actor_user_id, created_at, repost_id);

-- One pinned item per user profile; replacing the pin is a single row update.
CREATE TABLE IF NOT EXISTS social_profile_pins (
  user_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_social_profile_pins_content
  ON social_profile_pins (content_id);
