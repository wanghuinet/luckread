\\set ON_ERROR_STOP on
BEGIN;

DO $w03_d1_02_postgres_verify$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'content_collections','content_id_snowflake_state','content_mutation_idempotency',
    'content_outbox_events','content_relationships','content_revisions','content_series',
    'content_txn_guard','contents'
  ];
  actual_tables TEXT[];
  required_indexes TEXT[] := ARRAY[
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
    'content_collections_state_updated_idx'
  ];
  actual_indexes TEXT[];
  expected_triggers TEXT[] := ARRAY[
    'content_collections_after_insert_outbox','content_collections_after_update_outbox',
    'content_relationships_after_insert_outbox','content_relationships_after_update_outbox',
    'content_series_after_insert_outbox','content_series_after_update_outbox',
    'contents_after_insert_outbox','contents_after_update_outbox'
  ];
  actual_triggers TEXT[];
  v_event_count INTEGER;
BEGIN
  IF current_database() <> 'luckread_d1_02_schema' THEN
    RAISE EXCEPTION 'W03 D1-02 verifier must run only against luckread_d1_02_schema';
  END IF;
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'W03 D1-02 schema verifier requires PostgreSQL 18';
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
    INTO actual_tables
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'W03 expected exact nine-table schema; found %', actual_tables;
  END IF;

  SELECT array_agg(indexname ORDER BY indexname)
    INTO actual_indexes
    FROM pg_indexes
   WHERE schemaname = 'public';
  IF NOT (required_indexes <@ COALESCE(actual_indexes, ARRAY[]::TEXT[])) THEN
    RAISE EXCEPTION 'W03 required index set is incomplete; found %', actual_indexes;
  END IF;

  SELECT array_agg(t.tgname ORDER BY t.tgname)
    INTO actual_triggers
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF actual_triggers IS DISTINCT FROM expected_triggers THEN
    RAISE EXCEPTION 'W03 trigger inventory mismatch; found %', actual_triggers;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND c.contype = 'f'
  ) THEN
    RAISE EXCEPTION 'W03 must not introduce foreign keys across opaque domain references';
  END IF;

  IF (SELECT COUNT(*) FROM content_id_snowflake_state) <> 1
     OR NOT EXISTS (SELECT 1 FROM content_id_snowflake_state
                    WHERE id = 1 AND last_timestamp_ms = -1 AND sequence = 4095) THEN
    RAISE EXCEPTION 'W03 Snowflake allocator singleton state is missing or drifted';
  END IF;

  IF (SELECT COUNT(*) FROM contents) <> 0
     OR (SELECT COUNT(*) FROM content_mutation_idempotency) <> 0
     OR (SELECT COUNT(*) FROM content_outbox_events) <> 0
     OR (SELECT COUNT(*) FROM content_txn_guard) <> 0
     OR (SELECT COUNT(*) FROM content_revisions) <> 0
     OR (SELECT COUNT(*) FROM content_relationships) <> 0
     OR (SELECT COUNT(*) FROM content_series) <> 0
     OR (SELECT COUNT(*) FROM content_collections) <> 0 THEN
    RAISE EXCEPTION 'W03 business tables must be empty before synthetic verification';
  END IF;

  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='contents' AND column_name='created_at')
       <> 'timestamp with time zone'
     OR (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='content_outbox_events' AND column_name='payload_json')
       <> 'text'
     OR (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='contents' AND column_name='media_refs_json')
       <> 'text' THEN
    RAISE EXCEPTION 'W03 timestamp/JSON-text type mapping drift';
  END IF;

  INSERT INTO contents (
    id, content_type, owner_user_id, state, version, revision, title,
    body_ref, etag, created_at, updated_at, slug
  ) VALUES
    ('w03-test-content-1', 'post', 'w03-test-user', 'DRAFT', 1, 1, 'Test post one',
     'w03-test-body-1', 'etag-1', now(), now(), 'test-post-one'),
    ('w03-test-content-2', 'article', 'w03-test-user', 'DRAFT', 1, 1, 'Test article two',
     'w03-test-body-2', 'etag-2', now(), now(), 'test-article-two');

  SELECT COUNT(*) INTO v_event_count
    FROM content_outbox_events
   WHERE event_type = 'content.created'
     AND payload_json::json ->> 'slug' IN ('test-post-one', 'test-article-two');
  IF v_event_count <> 2 THEN
    RAISE EXCEPTION 'W03 content insert outbox event/payload contract failed: %', v_event_count;
  END IF;

  UPDATE contents SET state='DELETED', version=2, updated_at=now()
   WHERE id='w03-test-content-1';
  IF NOT EXISTS (
    SELECT 1 FROM content_outbox_events
     WHERE event_type='content.deleted' AND operation_id='deleteContent'
       AND content_id='w03-test-content-1'
       AND payload_json::json ->> 'fromState'='DRAFT'
       AND payload_json::json ->> 'toState'='DELETED'
  ) THEN RAISE EXCEPTION 'W03 content update outbox mapping failed'; END IF;

  INSERT INTO content_revisions (
    id, content_id, revision, content_version, actor_user_id, operation, state,
    title, body_ref, etag, correlation_id, created_at, slug
  ) VALUES (
    'w03-test-revision-1','w03-test-content-1',1,1,'w03-test-user','CREATE',
    'DRAFT','Test post one','w03-test-body-1','etag-1','w03-test-correlation',
    now(),'test-post-one'
  );

  INSERT INTO content_series (
    id, owner_user_id, creator_id, state, version, title, etag, created_at, updated_at
  ) VALUES ('w03-test-series-1','w03-test-user','w03-test-creator','DRAFT',1,
            'Test series','series-etag-1',now(),now());
  INSERT INTO content_collections (
    id, owner_user_id, creator_id, state, version, title, etag, created_at, updated_at
  ) VALUES ('w03-test-collection-1','w03-test-user','w03-test-creator','DRAFT',1,
            'Test collection','collection-etag-1',now(),now());

  INSERT INTO content_relationships (
    relationship_id, source_type, source_id, target_type, target_id, relation_type,
    position, schema_version, status, actor_id, created_at, updated_at
  ) VALUES
    ('w03-test-rel-series','content','w03-test-content-1','series','w03-test-series-1',
     'series-member',0,1,'ACTIVE','w03-test-user',now(),now()),
    ('w03-test-rel-collection','content','w03-test-content-2','collection','w03-test-collection-1',
     'collection-member',0,1,'ACTIVE','w03-test-user',now(),now()),
    ('w03-test-rel-thread','content','w03-test-content-1','content','w03-test-content-2',
     'thread-next',NULL,1,'ACTIVE','w03-test-user',now(),now()),
    ('w03-test-rel-reference','content','w03-test-content-2','content','w03-test-content-1',
     'reference',NULL,1,'ACTIVE','w03-test-user',now(),now());

  UPDATE content_relationships SET position=1, updated_at=now()
   WHERE relationship_id='w03-test-rel-series';
  UPDATE content_relationships SET status='REVOKED', updated_at=now()
   WHERE relationship_id='w03-test-rel-collection';

  SELECT COUNT(*) INTO v_event_count
    FROM content_outbox_events
   WHERE event_type IN ('content.series.attached','content.collection.attached',
                        'content.relationship.created','content.relationship.updated',
                        'content.relationship.revoked');
  IF v_event_count <> 6 THEN
    RAISE EXCEPTION 'W03 relationship outbox trigger count mismatch: %', v_event_count;
  END IF;

  UPDATE content_series SET state='DELETED', version=2, updated_at=now()
   WHERE id='w03-test-series-1';
  UPDATE content_collections SET state='DELETED', version=2, updated_at=now()
   WHERE id='w03-test-collection-1';
  IF NOT EXISTS (SELECT 1 FROM content_outbox_events
                  WHERE event_type='series.deleted' AND operation_id='deleteSeries') THEN
    RAISE EXCEPTION 'W03 series update outbox mapping failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM content_outbox_events
                  WHERE event_type='collection.deleted' AND operation_id='deleteCollection') THEN
    RAISE EXCEPTION 'W03 collection update outbox mapping failed';
  END IF;

  IF EXISTS (SELECT 1 FROM content_outbox_events WHERE event_id !~ '^[0-9a-f]{32}$') THEN
    RAISE EXCEPTION 'W03 outbox event IDs must retain lowercase 32-character hex format';
  END IF;
END;
$w03_d1_02_postgres_verify$;

ROLLBACK;
