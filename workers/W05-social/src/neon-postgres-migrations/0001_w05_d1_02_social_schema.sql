-- GENERATED FILE. Do not hand-edit.
-- Regenerate with workers/W05-social/scripts/neon/generate-d1-02-postgres-migration.mjs.
-- Template: workers/W05-social/scripts/neon/templates/d1-02-social-postgres.sql.
-- Source authority: W05 / D1-02; Cloudflare D1 remains the current runtime authority.

-- W05 / D1-02 PostgreSQL 18 schema-only bootstrap.
-- Source authority: W05 / D1-02 social graph, interactions and notification delivery state.
-- Endpoint state remains owned by W09 / D1-03 and is intentionally not created here.
-- Existing runtime authority remains Cloudflare D1; this artifact is for an empty Neon schema rehearsal.
BEGIN;

CREATE TABLE social_follow_relationships (
  relationship_id TEXT PRIMARY KEY NOT NULL,
  follower_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE interaction_likes (
  relationship_id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'comment')),
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_comments (
  id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  parent_id TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'PUBLISHED', 'REJECTED', 'DELETED', 'AUTHOR_DELETED')),
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 3),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (author_user_id, idempotency_key)
);
CREATE TABLE interaction_favorites (
  relationship_id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'content'),
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_share_links (
  share_id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (actor_user_id, idempotency_key)
);
CREATE TABLE social_user_interactions (
  relationship_id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('block', 'mute')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (actor_user_id, target_user_id, relation_type)
);
CREATE TABLE social_topics (
  topic_id TEXT PRIMARY KEY NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'RESTRICTED', 'RETIRED')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_target_topics (
  relation_id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'comment')),
  target_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (target_type, target_id, topic_id)
);
CREATE TABLE social_mentions (
  mention_id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'comment')),
  target_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  mentioned_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (target_type, target_id, mentioned_user_id)
);
CREATE TABLE social_notifications (
  notification_id TEXT PRIMARY KEY NOT NULL,
  recipient_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION')),
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'content', 'comment')),
  target_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_typeof(payload_json::json) = 'object'),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_notification_preferences (
  user_id TEXT PRIMARY KEY NOT NULL,
  follow_enabled INTEGER NOT NULL DEFAULT 1 CHECK (follow_enabled IN (0, 1)),
  like_enabled INTEGER NOT NULL DEFAULT 1 CHECK (like_enabled IN (0, 1)),
  comment_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comment_enabled IN (0, 1)),
  mention_enabled INTEGER NOT NULL DEFAULT 1 CHECK (mention_enabled IN (0, 1)),
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_reposts (
  repost_id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (actor_user_id, content_id)
);
CREATE TABLE social_profile_pins (
  user_id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_polls (
  poll_id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  duration_hours INTEGER NOT NULL CHECK (duration_hours IN (24, 72, 168)),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 1440
    CHECK (duration_minutes BETWEEN 5 AND 10080)
);
CREATE TABLE social_poll_options (
  option_id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  option_text TEXT NOT NULL CHECK (char_length(option_text) BETWEEN 1 AND 50),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  UNIQUE (poll_id, position),
  UNIQUE (poll_id, option_text)
);
CREATE TABLE social_poll_votes (
  vote_id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (poll_id, user_id)
);
CREATE TABLE social_content_reply_policies (
  content_id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  audience TEXT NOT NULL
    CHECK (audience IN ('everyone', 'verified', 'following', 'mentioned', 'followingNetwork')),
  mentioned_user_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      CASE
        WHEN json_typeof(mentioned_user_ids_json::json) = 'array'
          THEN json_array_length(mentioned_user_ids_json::json) <= 20
        ELSE FALSE
      END
    ),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_notification_push_outbox (
  notification_id TEXT PRIMARY KEY NOT NULL,
  recipient_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'FANNED_OUT', 'NO_ENDPOINT')),
  endpoint_count INTEGER NOT NULL DEFAULT 0 CHECK (endpoint_count >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_notification_push_deliveries (
  delivery_id TEXT PRIMARY KEY NOT NULL,
  notification_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'LEASED', 'RECEIPT_PENDING', 'RECEIPT_LEASED',
      'PROVIDER_ACCEPTED', 'RETRY', 'FAILED', 'CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  receipt_poll_count INTEGER NOT NULL DEFAULT 0 CHECK (receipt_poll_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  expo_ticket_id TEXT,
  push_token_hash TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (notification_id, endpoint_id)
);

CREATE UNIQUE INDEX uq_social_follow_follower_target ON social_follow_relationships (follower_user_id, target_user_id);
CREATE INDEX ix_social_follow_follower_created ON social_follow_relationships (follower_user_id, created_at);
CREATE INDEX ix_social_follow_target_created ON social_follow_relationships (target_user_id, created_at);
CREATE UNIQUE INDEX uq_interaction_like_actor_target ON interaction_likes (actor_user_id, target_type, target_id);
CREATE INDEX ix_interaction_like_target_created ON interaction_likes (target_type, target_id, created_at);
CREATE INDEX ix_interaction_like_actor_created ON interaction_likes (actor_user_id, created_at);
CREATE INDEX ix_social_comments_content_state_created ON social_comments (content_id, state, created_at, id);
CREATE INDEX ix_social_comments_parent_created ON social_comments (parent_id, created_at, id);
CREATE INDEX ix_social_comments_author_created ON social_comments (author_user_id, created_at, id);
CREATE UNIQUE INDEX uq_interaction_favorite_actor_target ON interaction_favorites (actor_user_id, target_type, target_id);
CREATE INDEX ix_interaction_favorite_actor_created ON interaction_favorites (actor_user_id, created_at);
CREATE INDEX ix_interaction_favorite_target_created ON interaction_favorites (target_type, target_id, created_at);
CREATE INDEX ix_social_share_links_content_created ON social_share_links (content_id, created_at);
CREATE INDEX ix_social_share_links_actor_created ON social_share_links (actor_user_id, created_at);
CREATE INDEX ix_social_user_interactions_actor_type_created ON social_user_interactions (actor_user_id, relation_type, created_at);
CREATE INDEX ix_social_user_interactions_target_type_created ON social_user_interactions (target_user_id, relation_type, created_at);
CREATE INDEX ix_social_topics_status_updated ON social_topics (status, updated_at);
CREATE INDEX ix_social_target_topics_topic_created ON social_target_topics (topic_id, created_at);
CREATE INDEX ix_social_target_topics_target ON social_target_topics (target_type, target_id, created_at);
CREATE INDEX ix_social_target_topics_content_topic_target ON social_target_topics (topic_id, target_id) WHERE target_type = 'content';
CREATE INDEX ix_social_mentions_recipient_created ON social_mentions (mentioned_user_id, created_at);
CREATE INDEX ix_social_mentions_target_created ON social_mentions (target_type, target_id, created_at);
CREATE INDEX ix_social_notifications_recipient_created ON social_notifications (recipient_user_id, created_at, notification_id);
CREATE INDEX ix_social_notifications_recipient_unread ON social_notifications (recipient_user_id, read_at, created_at);
CREATE INDEX ix_social_reposts_content_created ON social_reposts (content_id, created_at, repost_id);
CREATE INDEX ix_social_reposts_actor_created ON social_reposts (actor_user_id, created_at, repost_id);
CREATE INDEX ix_social_profile_pins_content ON social_profile_pins (content_id);
CREATE INDEX ix_social_polls_owner_updated ON social_polls (owner_user_id, updated_at);
CREATE INDEX ix_social_poll_options_poll_position ON social_poll_options (poll_id, position);
CREATE INDEX ix_social_poll_votes_option_created ON social_poll_votes (poll_id, option_id, created_at);
CREATE INDEX ix_social_content_reply_policies_owner ON social_content_reply_policies (owner_user_id, updated_at);
CREATE INDEX ix_social_notification_push_outbox_status_created ON social_notification_push_outbox (status, created_at, notification_id);
CREATE INDEX ix_social_notification_push_deliveries_due ON social_notification_push_deliveries (status, next_attempt_at, created_at);
CREATE INDEX ix_social_notification_push_deliveries_endpoint ON social_notification_push_deliveries (endpoint_id, status, updated_at);
CREATE UNIQUE INDEX uq_social_notification_push_ticket ON social_notification_push_deliveries (expo_ticket_id) WHERE expo_ticket_id IS NOT NULL;

CREATE FUNCTION w05_enqueue_social_notification_push_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO social_notification_push_outbox (
    notification_id, recipient_user_id, status, endpoint_count, created_at, updated_at
  ) VALUES (NEW.notification_id, NEW.recipient_user_id, 'PENDING', 0, NEW.created_at, NEW.created_at)
  ON CONFLICT (notification_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_social_notifications_push_outbox_insert
AFTER INSERT ON social_notifications
FOR EACH ROW EXECUTE FUNCTION w05_enqueue_social_notification_push_outbox();

COMMIT;
