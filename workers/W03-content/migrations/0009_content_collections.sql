-- 1.1 Collection foundation.
-- W03/D1-02 owns Collection metadata; Creator identity remains W08/W02 authority.
-- Reuses existing D1-02 idempotency and outbox infrastructure.

CREATE TABLE content_collections (
  id TEXT NOT NULL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  ip_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
      'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED'
    )
  ),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  description TEXT NOT NULL DEFAULT '',
  cover_ref TEXT,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX content_collections_owner_updated_idx
  ON content_collections(owner_user_id, updated_at DESC, id DESC);

CREATE INDEX content_collections_state_updated_idx
  ON content_collections(state, updated_at DESC, id DESC);

CREATE TRIGGER content_collections_after_insert_outbox
AFTER INSERT ON content_collections
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    'createCollection',
    'collection.created',
    NEW.id,
    NEW.version,
    json_object(
      'schemaVersion', '1.0',
      'collectionId', NEW.id,
      'ownerUserId', NEW.owner_user_id,
      'creatorId', NEW.creator_id,
      'state', NEW.state,
      'version', NEW.version,
      'etag', NEW.etag
    ),
    NEW.created_at,
    NULL
  );
END;

CREATE TRIGGER content_collections_after_update_outbox
AFTER UPDATE ON content_collections
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    CASE
      WHEN NEW.state = 'DELETED' THEN 'deleteCollection'
      WHEN OLD.state <> NEW.state THEN 'transitionCollectionState'
      ELSE 'updateCollection'
    END,
    CASE
      WHEN NEW.state = 'DELETED' THEN 'collection.deleted'
      WHEN OLD.state <> NEW.state THEN 'collection.state_changed'
      ELSE 'collection.updated'
    END,
    NEW.id,
    NEW.version,
    json_object(
      'schemaVersion', '1.0',
      'collectionId', NEW.id,
      'ownerUserId', NEW.owner_user_id,
      'creatorId', NEW.creator_id,
      'fromState', OLD.state,
      'toState', NEW.state,
      'version', NEW.version,
      'etag', NEW.etag
    ),
    NEW.updated_at,
    NULL
  );
END;
