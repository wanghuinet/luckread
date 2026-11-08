\set ON_ERROR_STOP on
BEGIN;
DO $d1_02_combined_catalog$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'content_collections','content_id_snowflake_state','content_mutation_idempotency',
    'content_outbox_events','content_relationships','content_revisions','content_series',
    'content_txn_guard','contents','interaction_favorites','interaction_likes',
    'social_comments','social_content_reply_policies','social_follow_relationships',
    'social_mentions','social_notification_preferences','social_notification_push_deliveries',
    'social_notification_push_outbox','social_notifications','social_poll_options',
    'social_poll_votes','social_polls','social_profile_pins','social_reposts',
    'social_share_links','social_target_topics','social_topics','social_user_interactions'
  ];
  expected_indexes TEXT[] := ARRAY[
    'contents_state_idx','contents_owner_user_id_idx','contents_creator_id_idx',
    'contents_ip_id_idx','contents_updated_at_idx','contents_state_updated_at_id_idx',
    'contents_owner_updated_at_id_idx','contents_slug_unique_idx','contents_scheduled_due_idx',
    'content_mutation_idempotency_expiry_idx','content_outbox_events_content_idx',
    'content_outbox_events_unpublished_idx','content_revisions_content_created_idx',
    'content_revisions_actor_created_idx','content_revisions_content_slug_idx',
    'content_relationships_active_unique_idx','content_relationships_series_position_unique_idx',
    'content_relationships_collection_position_unique_idx','content_relationships_thread_next_unique_idx',
    'content_relationships_thread_previous_unique_idx','content_relationships_source_created_idx',
    'content_relationships_target_created_idx','content_relationships_series_order_idx',
    'content_relationships_collection_order_idx','content_series_owner_updated_idx',
    'content_series_state_updated_idx','content_collections_owner_updated_idx',
    'content_collections_state_updated_idx',
    'uq_social_follow_follower_target','ix_social_follow_follower_created',
    'ix_social_follow_target_created','uq_interaction_like_actor_target',
    'ix_interaction_like_target_created','ix_interaction_like_actor_created',
    'ix_social_comments_content_state_created','ix_social_comments_parent_created',
    'ix_social_comments_author_created','uq_interaction_favorite_actor_target',
    'ix_interaction_favorite_actor_created','ix_interaction_favorite_target_created',
    'ix_social_share_links_content_created','ix_social_share_links_actor_created',
    'ix_social_user_interactions_actor_type_created',
    'ix_social_user_interactions_target_type_created','ix_social_topics_status_updated',
    'ix_social_target_topics_topic_created','ix_social_target_topics_target',
    'ix_social_target_topics_content_topic_target','ix_social_mentions_recipient_created',
    'ix_social_mentions_target_created','ix_social_notifications_recipient_created',
    'ix_social_notifications_recipient_unread','ix_social_reposts_content_created',
    'ix_social_reposts_actor_created','ix_social_profile_pins_content',
    'ix_social_polls_owner_updated','ix_social_poll_options_poll_position',
    'ix_social_poll_votes_option_created','ix_social_content_reply_policies_owner',
    'ix_social_notification_push_outbox_status_created',
    'ix_social_notification_push_deliveries_due',
    'ix_social_notification_push_deliveries_endpoint','uq_social_notification_push_ticket'
  ];
  expected_triggers TEXT[] := ARRAY[
    'contents_after_insert_outbox','contents_after_update_outbox',
    'content_relationships_after_insert_outbox','content_relationships_after_update_outbox',
    'content_series_after_insert_outbox','content_series_after_update_outbox',
    'content_collections_after_insert_outbox','content_collections_after_update_outbox',
    'trg_social_notifications_push_outbox_insert'
  ];
  expected_functions TEXT[] := ARRAY[
    'w03_append_content_outbox_event','w03_contents_after_insert_outbox',
    'w03_contents_after_update_outbox','w03_content_relationships_after_insert_outbox',
    'w03_content_relationships_after_update_outbox','w03_content_series_after_insert_outbox',
    'w03_content_series_after_update_outbox','w03_content_collections_after_insert_outbox',
    'w03_content_collections_after_update_outbox','w05_enqueue_social_notification_push_outbox'
  ];
  actual TEXT[];
  expected_sorted TEXT[];
BEGIN
  IF current_database() <> 'luckread_d1_02_schema' THEN
    RAISE EXCEPTION 'Combined D1-02 rehearsal must use disposable luckread_d1_02_schema';
  END IF;
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'Combined D1-02 rehearsal requires PostgreSQL 18';
  END IF;

  SELECT array_agg(table_name ORDER BY table_name) INTO actual
    FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';
  SELECT array_agg(x ORDER BY x) INTO expected_sorted FROM unnest(expected_tables) x;
  IF actual IS DISTINCT FROM expected_sorted THEN RAISE EXCEPTION 'Combined D1-02 table set mismatch: %',actual; END IF;

  SELECT array_agg(indexname ORDER BY indexname) INTO actual
    FROM pg_indexes WHERE schemaname='public' AND indexname=ANY(expected_indexes);
  SELECT array_agg(x ORDER BY x) INTO expected_sorted FROM unnest(expected_indexes) x;
  IF actual IS DISTINCT FROM expected_sorted THEN RAISE EXCEPTION 'Combined D1-02 explicit index set mismatch: %',actual; END IF;

  SELECT array_agg(tgname ORDER BY tgname) INTO actual
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal;
  SELECT array_agg(x ORDER BY x) INTO expected_sorted FROM unnest(expected_triggers) x;
  IF actual IS DISTINCT FROM expected_sorted THEN RAISE EXCEPTION 'Combined D1-02 trigger inventory mismatch: %',actual; END IF;

  SELECT array_agg(proname ORDER BY proname) INTO actual
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname=ANY(expected_functions);
  SELECT array_agg(x ORDER BY x) INTO expected_sorted FROM unnest(expected_functions) x;
  IF actual IS DISTINCT FROM expected_sorted THEN RAISE EXCEPTION 'Combined D1-02 trigger function inventory mismatch: %',actual; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.contype='f'
  ) THEN RAISE EXCEPTION 'Combined D1-02 must keep cross-domain identifiers opaque without foreign keys'; END IF;
  IF to_regclass('public.notification_push_endpoints') IS NOT NULL THEN
    RAISE EXCEPTION 'W09/D1-03 notification endpoint schema must not exist in D1-02';
  END IF;

  IF (SELECT count(*) FROM content_id_snowflake_state) <> 1
     OR NOT EXISTS (SELECT 1 FROM content_id_snowflake_state WHERE id=1 AND last_timestamp_ms=-1 AND sequence=4095) THEN
    RAISE EXCEPTION 'W03 Snowflake allocator singleton state missing or drifted';
  END IF;

  IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='contents' AND column_name='created_at') <> 'timestamp with time zone'
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='social_notifications' AND column_name='payload_json') <> 'text'
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='contents' AND column_name='media_refs_json') <> 'text'
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='social_notification_push_deliveries' AND column_name='next_attempt_at') <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'Combined D1-02 timestamp or serialized JSON type mapping drift';
  END IF;

  IF (SELECT count(*) FROM contents)+(SELECT count(*) FROM content_mutation_idempotency)+(SELECT count(*) FROM content_outbox_events)+(SELECT count(*) FROM content_txn_guard)+(SELECT count(*) FROM content_revisions)+(SELECT count(*) FROM content_relationships)+(SELECT count(*) FROM content_series)+(SELECT count(*) FROM content_collections)
     + (SELECT count(*) FROM social_follow_relationships)+(SELECT count(*) FROM interaction_likes)+(SELECT count(*) FROM social_comments)+(SELECT count(*) FROM interaction_favorites)+(SELECT count(*) FROM social_share_links)+(SELECT count(*) FROM social_user_interactions)+(SELECT count(*) FROM social_topics)+(SELECT count(*) FROM social_target_topics)+(SELECT count(*) FROM social_mentions)+(SELECT count(*) FROM social_notifications)+(SELECT count(*) FROM social_notification_preferences)+(SELECT count(*) FROM social_reposts)+(SELECT count(*) FROM social_profile_pins)+(SELECT count(*) FROM social_polls)+(SELECT count(*) FROM social_poll_options)+(SELECT count(*) FROM social_poll_votes)+(SELECT count(*) FROM social_content_reply_policies)+(SELECT count(*) FROM social_notification_push_outbox)+(SELECT count(*) FROM social_notification_push_deliveries) <> 0 THEN
    RAISE EXCEPTION 'All W03/W05 business tables must be empty before synthetic verification';
  END IF;
END;
$d1_02_combined_catalog$;

INSERT INTO contents (
  id,content_type,owner_user_id,state,version,revision,title,body_ref,etag,created_at,updated_at,slug
) VALUES
  ('d102-test-content-1','post','d102-test-user','DRAFT',1,1,'Test post one','d102-body-1','d102-etag-1',now(),now(),'d102-test-post-one'),
  ('d102-test-content-2','article','d102-test-user','DRAFT',1,1,'Test article two','d102-body-2','d102-etag-2',now(),now(),'d102-test-article-two');

DO $content_events$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM content_outbox_events
   WHERE event_type='content.created' AND payload_json::json ->> 'slug' IN ('d102-test-post-one','d102-test-article-two');
  IF v_count <> 2 THEN RAISE EXCEPTION 'W03 content.created trigger/outbox contract failed: %',v_count; END IF;
END;
$content_events$;

UPDATE contents SET state='DELETED',version=2,updated_at=now() WHERE id='d102-test-content-1';
INSERT INTO content_revisions (
  id,content_id,revision,content_version,actor_user_id,operation,state,title,body_ref,etag,correlation_id,created_at,slug
) VALUES ('d102-test-revision-1','d102-test-content-1',1,1,'d102-test-user','CREATE','DRAFT','Test post one','d102-body-1','d102-etag-1','d102-correlation',now(),'d102-test-post-one');

INSERT INTO content_series (id,owner_user_id,creator_id,state,version,title,etag,created_at,updated_at)
VALUES ('d102-test-series-1','d102-test-user','d102-test-creator','DRAFT',1,'Test series','d102-series-etag',now(),now());
INSERT INTO content_collections (id,owner_user_id,creator_id,state,version,title,etag,created_at,updated_at)
VALUES ('d102-test-collection-1','d102-test-user','d102-test-creator','DRAFT',1,'Test collection','d102-collection-etag',now(),now());

INSERT INTO content_relationships (
  relationship_id,source_type,source_id,target_type,target_id,relation_type,position,
  schema_version,status,actor_id,created_at,updated_at
) VALUES
  ('d102-test-rel-series','content','d102-test-content-1','series','d102-test-series-1','series-member',0,1,'ACTIVE','d102-test-user',now(),now()),
  ('d102-test-rel-collection','content','d102-test-content-2','collection','d102-test-collection-1','collection-member',0,1,'ACTIVE','d102-test-user',now(),now()),
  ('d102-test-rel-thread','content','d102-test-content-1','content','d102-test-content-2','thread-next',NULL,1,'ACTIVE','d102-test-user',now(),now()),
  ('d102-test-rel-reference','content','d102-test-content-2','content','d102-test-content-1','reference',NULL,1,'ACTIVE','d102-test-user',now(),now());
UPDATE content_relationships SET position=1,updated_at=now() WHERE relationship_id='d102-test-rel-series';
UPDATE content_relationships SET status='REVOKED',updated_at=now() WHERE relationship_id='d102-test-rel-collection';

DO $content_relationships$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM content_outbox_events
   WHERE event_type IN ('content.series.attached','content.collection.attached','content.relationship.created','content.relationship.updated','content.relationship.revoked');
  IF v_count <> 6 THEN RAISE EXCEPTION 'W03 relationship event semantics mismatch: %',v_count; END IF;
END;
$content_relationships$;

UPDATE content_series SET state='DELETED',version=2,updated_at=now() WHERE id='d102-test-series-1';
UPDATE content_collections SET state='DELETED',version=2,updated_at=now() WHERE id='d102-test-collection-1';

INSERT INTO interaction_likes (relationship_id,actor_user_id,target_type,target_id,created_at)
VALUES ('d102-test-like-1','d102-test-actor','content','d102-test-content-2',now());
INSERT INTO social_notifications (
  notification_id,recipient_user_id,actor_user_id,notification_type,target_type,target_id,dedupe_key,payload_json,read_at,created_at
) VALUES (
  'd102-test-notification-1','d102-test-user','d102-test-actor','LIKE','content',
  'd102-test-content-2','d102-test-dedupe','{"source":"combined-rehearsal"}',NULL,now()
);

DO $social_outbox$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM social_notification_push_outbox
     WHERE notification_id='d102-test-notification-1' AND recipient_user_id='d102-test-user'
       AND status='PENDING' AND endpoint_count=0
  ) THEN RAISE EXCEPTION 'W05 notification-to-push-outbox trigger contract failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM interaction_likes l JOIN contents c ON c.id=l.target_id
     WHERE l.relationship_id='d102-test-like-1' AND c.id='d102-test-content-2'
  ) THEN RAISE EXCEPTION 'W05 social reference to W03 content ID failed'; END IF;
END;
$social_outbox$;

INSERT INTO social_notification_push_deliveries (
  delivery_id,notification_id,endpoint_id,next_attempt_at,created_at,updated_at
) VALUES ('d102-test-delivery-1','d102-test-notification-1','opaque-d1-03-endpoint-id',now(),now(),now());
INSERT INTO social_polls (poll_id,content_id,owner_user_id,duration_hours,created_at,updated_at)
VALUES ('d102-test-poll-1','d102-test-content-2','d102-test-user',24,now(),now());

DO $delivery_and_poll$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM social_polls WHERE poll_id='d102-test-poll-1' AND duration_minutes=1440) THEN
    RAISE EXCEPTION 'W05 duration_minutes final-state default mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM social_notification_push_deliveries
    WHERE delivery_id='d102-test-delivery-1' AND endpoint_id='opaque-d1-03-endpoint-id') THEN
    RAISE EXCEPTION 'W05 opaque D1-03 endpoint reference was not retained';
  END IF;
END;
$delivery_and_poll$;

ROLLBACK;
