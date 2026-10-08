-- SOCIAL-CLOSURE-V1
-- W05 / D1-02 unified social closure for article, post and video.
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS interaction_likes_v2 (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content','comment')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO interaction_likes_v2
  (relationship_id, actor_user_id, target_type, target_id, created_at)
SELECT relationship_id, actor_user_id, target_type, target_id, created_at
FROM interaction_likes;

DROP TABLE interaction_likes;
ALTER TABLE interaction_likes_v2 RENAME TO interaction_likes;

CREATE UNIQUE INDEX IF NOT EXISTS uq_interaction_like_actor_target
  ON interaction_likes (actor_user_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS ix_interaction_like_target_created
  ON interaction_likes (target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS ix_interaction_like_actor_created
  ON interaction_likes (actor_user_id, created_at);

CREATE TABLE IF NOT EXISTS social_topics (
  topic_id TEXT NOT NULL PRIMARY KEY,
  normalized_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RESTRICTED','RETIRED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_social_topics_status_updated
  ON social_topics (status, updated_at);

CREATE TABLE IF NOT EXISTS social_target_topics (
  relation_id TEXT NOT NULL PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('content','comment')),
  target_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(target_type, target_id, topic_id)
);

CREATE INDEX IF NOT EXISTS ix_social_target_topics_topic_created
  ON social_target_topics (topic_id, created_at);
CREATE INDEX IF NOT EXISTS ix_social_target_topics_target
  ON social_target_topics (target_type, target_id, created_at);

CREATE TABLE IF NOT EXISTS social_mentions (
  mention_id TEXT NOT NULL PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('content','comment')),
  target_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  mentioned_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(target_type, target_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS ix_social_mentions_recipient_created
  ON social_mentions (mentioned_user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_social_mentions_target_created
  ON social_mentions (target_type, target_id, created_at);

CREATE TABLE IF NOT EXISTS social_notifications (
  notification_id TEXT NOT NULL PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('FOLLOW','LIKE','COMMENT','REPLY','MENTION')),
  target_type TEXT NOT NULL CHECK (target_type IN ('user','content','comment')),
  target_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_social_notifications_recipient_created
  ON social_notifications (recipient_user_id, created_at, notification_id);
CREATE INDEX IF NOT EXISTS ix_social_notifications_recipient_unread
  ON social_notifications (recipient_user_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS social_notification_outbox (
  event_id TEXT NOT NULL PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('FOLLOW','LIKE','COMMENT','REPLY','MENTION')),
  target_type TEXT NOT NULL CHECK (target_type IN ('user','content','comment')),
  target_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  created_at TEXT NOT NULL,
  dispatched_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_social_notification_outbox_pending
  ON social_notification_outbox (dispatched_at, created_at);

CREATE TABLE IF NOT EXISTS social_notification_preferences (
  user_id TEXT NOT NULL PRIMARY KEY,
  follow_enabled INTEGER NOT NULL DEFAULT 1 CHECK (follow_enabled IN (0,1)),
  like_enabled INTEGER NOT NULL DEFAULT 1 CHECK (like_enabled IN (0,1)),
  comment_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comment_enabled IN (0,1)),
  mention_enabled INTEGER NOT NULL DEFAULT 1 CHECK (mention_enabled IN (0,1)),
  updated_at TEXT NOT NULL
);

PRAGMA foreign_keys=ON;
