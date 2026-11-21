-- GENERATED FILE. Do not hand-edit.
-- Regenerate with workers/W03-content/scripts/neon/generate-d1-02-postgres-migration.mjs.
-- Template: workers/W03-content/scripts/neon/templates/d1-02-content-postgres.sql.
-- Source authority: W03 / D1-02; current runtime authority remains Cloudflare D1.
-- W03 / D1-02 PostgreSQL 18 schema-only bootstrap.
-- Logical target: D1-02 / luckreadpro. Runtime authority remains Cloudflare D1.
-- Source migrations 0001..0015 are SQLite/D1 and MUST NOT be executed on PostgreSQL.
-- This is the empty-database final schema: SQLite table rebuilds and the legacy
-- content_revisions backfill are intentionally folded out.
-- ID and outbox semantics are preserved. ISO-8601 TEXT timestamps map to
-- TIMESTAMPTZ; JSON payload/media-reference columns remain TEXT.
-- Domain IDs are opaque references: no foreign keys are introduced.
-- The content_id_snowflake_state singleton is required allocator state, not
-- imported business data.

BEGIN;

CREATE TABLE contents (
  id TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('article', 'post', 'video')),
  owner_user_id TEXT NOT NULL,
  creator_id TEXT,
  ip_id TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED',
    'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'
  )),
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
  body_ref TEXT NOT NULL UNIQUE,
  media_refs_json TEXT NOT NULL DEFAULT '[]',
  cover_ref TEXT,
  slug TEXT NOT NULL DEFAULT '',
  etag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  scheduled_at TIMESTAMPTZ,
  access_mode TEXT NOT NULL DEFAULT 'PUBLIC'
    CHECK (access_mode IN ('PUBLIC', 'MEMBERS_ONLY')),
  media_warning TEXT
    CHECK (media_warning IS NULL OR media_warning IN ('NUDITY', 'VIOLENCE', 'SENSITIVE'))
);

CREATE TABLE content_mutation_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_status INTEGER,
  response_json TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (owner_user_id, operation_id, idempotency_key)
);

CREATE TABLE content_outbox_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ
);

CREATE TABLE content_txn_guard (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  successful INTEGER NOT NULL CHECK (successful = 1)
);

CREATE TABLE content_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  content_version INTEGER NOT NULL CHECK (content_version >= 1),
  actor_user_id TEXT NOT NULL,
  source_revision INTEGER,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'ROLLBACK')),
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED',
    'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'
  )),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
  body_ref TEXT NOT NULL,
  media_refs_json TEXT NOT NULL DEFAULT '[]',
  cover_ref TEXT,
  slug TEXT NOT NULL DEFAULT '',
  access_mode TEXT NOT NULL DEFAULT 'PUBLIC'
    CHECK (access_mode IN ('PUBLIC', 'MEMBERS_ONLY')),
  media_warning TEXT
    CHECK (media_warning IS NULL OR media_warning IN ('NUDITY', 'VIOLENCE', 'SENSITIVE')),
  etag TEXT NOT NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (content_id, revision)
);

CREATE TABLE content_relationships (
  relationship_id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type = 'content'),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'series', 'collection')),
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('reference', 'series-member', 'collection-member', 'thread-next')),
  position INTEGER,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'SUPERSEDED')),
  actor_id TEXT NOT NULL,
  provenance_ref TEXT,
  authorization_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (relation_type = 'reference' AND target_type = 'content' AND position IS NULL)
    OR (relation_type = 'series-member' AND target_type = 'series' AND position IS NOT NULL AND position >= 0)
    OR (relation_type = 'collection-member' AND target_type = 'collection' AND position IS NOT NULL AND position >= 0)
    OR (relation_type = 'thread-next' AND target_type = 'content' AND position IS NULL)
  ),
  CHECK (source_type <> target_type OR source_id <> target_id)
);

CREATE TABLE content_series (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  ip_id TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED',
    'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'
  )),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
  description TEXT NOT NULL DEFAULT '',
  cover_ref TEXT,
  etag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE content_collections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED',
    'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'
  )),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
  description TEXT NOT NULL DEFAULT '',
  cover_ref TEXT,
  etag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE content_id_snowflake_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  last_timestamp_ms INTEGER NOT NULL CHECK (last_timestamp_ms >= -1),
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 4095)
);

CREATE INDEX contents_state_idx ON contents (state);
CREATE INDEX contents_owner_user_id_idx ON contents (owner_user_id);
CREATE INDEX contents_creator_id_idx ON contents (creator_id);
CREATE INDEX contents_ip_id_idx ON contents (ip_id);
CREATE INDEX contents_updated_at_idx ON contents (updated_at);
CREATE INDEX contents_state_updated_at_id_idx ON contents (state, updated_at, id);
CREATE INDEX contents_owner_updated_at_id_idx ON contents (owner_user_id, updated_at, id);
CREATE UNIQUE INDEX contents_slug_unique_idx ON contents (slug);
CREATE INDEX contents_scheduled_due_idx ON contents (state, scheduled_at, updated_at, id);

CREATE INDEX content_mutation_idempotency_expiry_idx
  ON content_mutation_idempotency (expires_at);
CREATE INDEX content_outbox_events_content_idx
  ON content_outbox_events (content_id, aggregate_version);
CREATE INDEX content_outbox_events_unpublished_idx
  ON content_outbox_events (published_at, created_at);
CREATE INDEX content_revisions_content_created_idx
  ON content_revisions (content_id, created_at DESC, id DESC);
CREATE INDEX content_revisions_actor_created_idx
  ON content_revisions (actor_user_id, created_at DESC, id DESC);
CREATE INDEX content_revisions_content_slug_idx
  ON content_revisions (content_id, slug);

CREATE UNIQUE INDEX content_relationships_active_unique_idx
  ON content_relationships (source_type, source_id, target_type, target_id, relation_type)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX content_relationships_series_position_unique_idx
  ON content_relationships (target_id, position)
  WHERE status = 'ACTIVE' AND relation_type = 'series-member';
CREATE UNIQUE INDEX content_relationships_collection_position_unique_idx
  ON content_relationships (target_id, position)
  WHERE status = 'ACTIVE' AND relation_type = 'collection-member';
CREATE UNIQUE INDEX content_relationships_thread_next_unique_idx
  ON content_relationships (source_id)
  WHERE status = 'ACTIVE' AND relation_type = 'thread-next';
CREATE UNIQUE INDEX content_relationships_thread_previous_unique_idx
  ON content_relationships (target_id)
  WHERE status = 'ACTIVE' AND relation_type = 'thread-next';
CREATE INDEX content_relationships_source_created_idx
  ON content_relationships (source_id, created_at DESC, relationship_id DESC);
CREATE INDEX content_relationships_target_created_idx
  ON content_relationships (target_id, created_at DESC, relationship_id DESC);
CREATE INDEX content_relationships_series_order_idx
  ON content_relationships (target_id, position ASC, relationship_id ASC)
  WHERE relation_type = 'series-member' AND status = 'ACTIVE';
CREATE INDEX content_relationships_collection_order_idx
  ON content_relationships (target_id, position ASC, relationship_id ASC)
  WHERE relation_type = 'collection-member' AND status = 'ACTIVE';

CREATE INDEX content_series_owner_updated_idx
  ON content_series (owner_user_id, updated_at DESC, id DESC);
CREATE INDEX content_series_state_updated_idx
  ON content_series (state, updated_at DESC, id DESC);
CREATE INDEX content_collections_owner_updated_idx
  ON content_collections (owner_user_id, updated_at DESC, id DESC);
CREATE INDEX content_collections_state_updated_idx
  ON content_collections (state, updated_at DESC, id DESC);

CREATE FUNCTION w03_append_content_outbox_event(
  p_operation_id TEXT,
  p_event_type TEXT,
  p_content_id TEXT,
  p_aggregate_version INTEGER,
  p_payload JSON,
  p_created_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    replace(gen_random_uuid()::TEXT, '-', ''),
    p_operation_id, p_event_type, p_content_id, p_aggregate_version,
    p_payload::TEXT, p_created_at, NULL
  );
END;
$$;

CREATE FUNCTION w03_contents_after_insert_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM w03_append_content_outbox_event(
    'createContent', 'content.created', NEW.id, NEW.version,
    json_build_object('id', NEW.id, 'slug', NEW.slug, 'state', NEW.state,
      'version', NEW.version, 'etag', NEW.etag),
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_contents_after_update_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_operation_id TEXT; v_event_type TEXT;
BEGIN
  v_operation_id := CASE
    WHEN NEW.state = 'DELETED' THEN 'deleteContent'
    WHEN OLD.state <> NEW.state THEN 'transitionContentState'
    ELSE 'updateContent'
  END;
  v_event_type := CASE
    WHEN NEW.state = 'DELETED' THEN 'content.deleted'
    WHEN OLD.state <> NEW.state THEN 'content.state_changed'
    ELSE 'content.updated'
  END;
  PERFORM w03_append_content_outbox_event(
    v_operation_id, v_event_type, NEW.id, NEW.version,
    json_build_object('id', NEW.id, 'slug', NEW.slug, 'fromState', OLD.state,
      'toState', NEW.state, 'version', NEW.version, 'etag', NEW.etag),
    NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_content_relationships_after_insert_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_operation_id TEXT; v_event_type TEXT; v_aggregate_version INTEGER;
BEGIN
  v_operation_id := CASE
    WHEN NEW.relation_type = 'series-member' THEN 'attachSeriesMember'
    WHEN NEW.relation_type = 'collection-member' THEN 'attachCollectionMember'
    WHEN NEW.relation_type = 'thread-next' THEN 'appendPostThreadNext'
    ELSE 'createContentRelationship'
  END;
  v_event_type := CASE
    WHEN NEW.relation_type = 'series-member' THEN 'content.series.attached'
    WHEN NEW.relation_type = 'collection-member' THEN 'content.collection.attached'
    ELSE 'content.relationship.created'
  END;
  v_aggregate_version := CASE
    WHEN NEW.relation_type = 'series-member'
      THEN COALESCE((SELECT version FROM content_series WHERE id = NEW.target_id), 1)
    WHEN NEW.relation_type = 'collection-member'
      THEN COALESCE((SELECT version FROM content_collections WHERE id = NEW.target_id), 1)
    ELSE COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1)
  END;
  PERFORM w03_append_content_outbox_event(
    v_operation_id, v_event_type, NEW.source_id, v_aggregate_version,
    json_build_object('schemaVersion', '1.0', 'relationshipId', NEW.relationship_id,
      'sourceType', NEW.source_type, 'sourceId', NEW.source_id,
      'targetType', NEW.target_type, 'targetId', NEW.target_id,
      'relationType', NEW.relation_type, 'position', NEW.position, 'status', NEW.status),
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_content_relationships_after_update_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_operation_id TEXT; v_event_type TEXT; v_aggregate_version INTEGER;
BEGIN
  v_operation_id := CASE
    WHEN NEW.status = 'REVOKED' THEN 'revokeContentRelationship'
    WHEN NEW.relation_type = 'series-member' AND COALESCE(OLD.position, -1) <> COALESCE(NEW.position, -1)
      THEN 'reorderSeriesMember'
    WHEN NEW.relation_type = 'collection-member' AND COALESCE(OLD.position, -1) <> COALESCE(NEW.position, -1)
      THEN 'reorderCollectionMember'
    ELSE 'updateContentRelationship'
  END;
  v_event_type := CASE
    WHEN NEW.status = 'REVOKED' THEN 'content.relationship.revoked'
    ELSE 'content.relationship.updated'
  END;
  v_aggregate_version := CASE
    WHEN NEW.relation_type = 'series-member'
      THEN COALESCE((SELECT version FROM content_series WHERE id = NEW.target_id), 1)
    WHEN NEW.relation_type = 'collection-member'
      THEN COALESCE((SELECT version FROM content_collections WHERE id = NEW.target_id), 1)
    ELSE COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1)
  END;
  PERFORM w03_append_content_outbox_event(
    v_operation_id, v_event_type, NEW.source_id, v_aggregate_version,
    json_build_object('schemaVersion', '1.0', 'relationshipId', NEW.relationship_id,
      'sourceType', NEW.source_type, 'sourceId', NEW.source_id,
      'targetType', NEW.target_type, 'targetId', NEW.target_id,
      'relationType', NEW.relation_type, 'position', NEW.position, 'status', NEW.status),
    NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_content_series_after_insert_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM w03_append_content_outbox_event(
    'createSeries', 'series.created', NEW.id, NEW.version,
    json_build_object('schemaVersion', '1.0', 'seriesId', NEW.id,
      'ownerUserId', NEW.owner_user_id, 'creatorId', NEW.creator_id,
      'state', NEW.state, 'version', NEW.version, 'etag', NEW.etag),
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_content_series_after_update_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_operation_id TEXT; v_event_type TEXT;
BEGIN
  v_operation_id := CASE
    WHEN NEW.state = 'DELETED' THEN 'deleteSeries'
    WHEN OLD.state <> NEW.state THEN 'transitionSeriesState'
    ELSE 'updateSeries'
  END;
  v_event_type := CASE
    WHEN NEW.state = 'DELETED' THEN 'series.deleted'
    WHEN OLD.state <> NEW.state THEN 'series.state_changed'
    ELSE 'series.updated'
  END;
  PERFORM w03_append_content_outbox_event(
    v_operation_id, v_event_type, NEW.id, NEW.version,
    json_build_object('schemaVersion', '1.0', 'seriesId', NEW.id,
      'ownerUserId', NEW.owner_user_id, 'creatorId', NEW.creator_id,
      'fromState', OLD.state, 'toState', NEW.state,
      'version', NEW.version, 'etag', NEW.etag),
    NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_content_collections_after_insert_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM w03_append_content_outbox_event(
    'createCollection', 'collection.created', NEW.id, NEW.version,
    json_build_object('schemaVersion', '1.0', 'collectionId', NEW.id,
      'ownerUserId', NEW.owner_user_id, 'creatorId', NEW.creator_id,
      'state', NEW.state, 'version', NEW.version, 'etag', NEW.etag),
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION w03_content_collections_after_update_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_operation_id TEXT; v_event_type TEXT;
BEGIN
  v_operation_id := CASE
    WHEN NEW.state = 'DELETED' THEN 'deleteCollection'
    WHEN OLD.state <> NEW.state THEN 'transitionCollectionState'
    ELSE 'updateCollection'
  END;
  v_event_type := CASE
    WHEN NEW.state = 'DELETED' THEN 'collection.deleted'
    WHEN OLD.state <> NEW.state THEN 'collection.state_changed'
    ELSE 'collection.updated'
  END;
  PERFORM w03_append_content_outbox_event(
    v_operation_id, v_event_type, NEW.id, NEW.version,
    json_build_object('schemaVersion', '1.0', 'collectionId', NEW.id,
      'ownerUserId', NEW.owner_user_id, 'creatorId', NEW.creator_id,
      'fromState', OLD.state, 'toState', NEW.state,
      'version', NEW.version, 'etag', NEW.etag),
    NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER contents_after_insert_outbox
AFTER INSERT ON contents FOR EACH ROW
EXECUTE FUNCTION w03_contents_after_insert_outbox();
CREATE TRIGGER contents_after_update_outbox
AFTER UPDATE ON contents FOR EACH ROW
EXECUTE FUNCTION w03_contents_after_update_outbox();

CREATE TRIGGER content_relationships_after_insert_outbox
AFTER INSERT ON content_relationships FOR EACH ROW
EXECUTE FUNCTION w03_content_relationships_after_insert_outbox();
CREATE TRIGGER content_relationships_after_update_outbox
AFTER UPDATE ON content_relationships FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR COALESCE(OLD.position, -1) IS DISTINCT FROM COALESCE(NEW.position, -1)
)
EXECUTE FUNCTION w03_content_relationships_after_update_outbox();

CREATE TRIGGER content_series_after_insert_outbox
AFTER INSERT ON content_series FOR EACH ROW
EXECUTE FUNCTION w03_content_series_after_insert_outbox();
CREATE TRIGGER content_series_after_update_outbox
AFTER UPDATE ON content_series FOR EACH ROW
EXECUTE FUNCTION w03_content_series_after_update_outbox();

CREATE TRIGGER content_collections_after_insert_outbox
AFTER INSERT ON content_collections FOR EACH ROW
EXECUTE FUNCTION w03_content_collections_after_insert_outbox();
CREATE TRIGGER content_collections_after_update_outbox
AFTER UPDATE ON content_collections FOR EACH ROW
EXECUTE FUNCTION w03_content_collections_after_update_outbox();

-- Required allocator singleton; no account/content/business rows are seeded.
INSERT INTO content_id_snowflake_state (id, last_timestamp_ms, sequence)
VALUES (1, -1, 4095);

COMMIT;
