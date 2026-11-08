\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE v_tables INTEGER; v_indexes INTEGER; v_triggers INTEGER;
BEGIN
  SELECT count(*) INTO v_tables FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  IF v_tables <> 19 THEN RAISE EXCEPTION 'Expected 19 W05 D1-02 tables, found %', v_tables; END IF;

  SELECT count(*) INTO v_indexes FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = ANY (ARRAY[
      'uq_social_follow_follower_target', 'ix_social_follow_follower_created',
      'ix_social_follow_target_created', 'uq_interaction_like_actor_target',
      'ix_interaction_like_target_created', 'ix_interaction_like_actor_created',
      'ix_social_comments_content_state_created', 'ix_social_comments_parent_created',
      'ix_social_comments_author_created', 'uq_interaction_favorite_actor_target',
      'ix_interaction_favorite_actor_created', 'ix_interaction_favorite_target_created',
      'ix_social_share_links_content_created', 'ix_social_share_links_actor_created',
      'ix_social_user_interactions_actor_type_created',
      'ix_social_user_interactions_target_type_created', 'ix_social_topics_status_updated',
      'ix_social_target_topics_topic_created', 'ix_social_target_topics_target',
      'ix_social_target_topics_content_topic_target', 'ix_social_mentions_recipient_created',
      'ix_social_mentions_target_created', 'ix_social_notifications_recipient_created',
      'ix_social_notifications_recipient_unread', 'ix_social_reposts_content_created',
      'ix_social_reposts_actor_created', 'ix_social_profile_pins_content',
      'ix_social_polls_owner_updated', 'ix_social_poll_options_poll_position',
      'ix_social_poll_votes_option_created', 'ix_social_content_reply_policies_owner',
      'ix_social_notification_push_outbox_status_created',
      'ix_social_notification_push_deliveries_due',
      'ix_social_notification_push_deliveries_endpoint', 'uq_social_notification_push_ticket'
    ]);
  IF v_indexes <> 35 THEN RAISE EXCEPTION 'Expected 35 named W05 D1-02 indexes, found %', v_indexes; END IF;

  SELECT count(*) INTO v_triggers FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_triggers <> 1 THEN RAISE EXCEPTION 'Expected one W05 user trigger, found %', v_triggers; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND c.contype = 'f'
  ) THEN RAISE EXCEPTION 'W05 identifiers must remain opaque without foreign keys'; END IF;

  IF to_regclass('public.notification_push_endpoints') IS NOT NULL THEN
    RAISE EXCEPTION 'D1-03/W09 endpoint table must not be present in D1-02';
  END IF;
END;
$$;

INSERT INTO social_notifications (
  notification_id, recipient_user_id, actor_user_id, notification_type,
  target_type, target_id, dedupe_key, payload_json, read_at, created_at
) VALUES (
  'verify-notification-1', 'verify-recipient', 'verify-actor', 'LIKE',
  'content', 'opaque-content-id', 'verify-dedupe-1', '{"verification":true}', NULL, now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM social_notification_push_outbox
    WHERE notification_id = 'verify-notification-1'
      AND recipient_user_id = 'verify-recipient'
      AND status = 'PENDING' AND endpoint_count = 0
  ) THEN RAISE EXCEPTION 'Notification insert did not atomically create its push outbox row'; END IF;
END;
$$;

INSERT INTO social_notification_push_deliveries (
  delivery_id, notification_id, endpoint_id, next_attempt_at, created_at, updated_at
) VALUES ('verify-delivery-1', 'verify-notification-1', 'opaque-d1-03-endpoint-id', now(), now(), now());

INSERT INTO social_polls (
  poll_id, content_id, owner_user_id, duration_hours, created_at, updated_at
) VALUES ('verify-poll-1', 'opaque-content-id', 'verify-owner', 24, now(), now());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM social_polls WHERE poll_id = 'verify-poll-1' AND duration_minutes = 1440
  ) THEN RAISE EXCEPTION 'duration_minutes default does not preserve the 24-hour source duration'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM social_notification_push_deliveries
    WHERE delivery_id = 'verify-delivery-1' AND endpoint_id = 'opaque-d1-03-endpoint-id'
  ) THEN RAISE EXCEPTION 'W05 delivery must retain an opaque D1-03 endpoint reference without a foreign key'; END IF;
END;
$$;
ROLLBACK;
