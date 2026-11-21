-- Generated from:
-- contracts/persistence/CONTENT-ARTICLE-d1-02-persistence.v1.json
-- Logical authority: D1-02 / W03
-- Physical D1 UUID intentionally unresolved; execution requires explicit
-- Cloudflare physical-binding admission.

CREATE TABLE contents (
  id TEXT NOT NULL PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type = 'article'),
  owner_user_id TEXT NOT NULL,
  creator_id TEXT,
  ip_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
      'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED'
    )
  ),
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  body_ref TEXT NOT NULL UNIQUE,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX contents_state_idx ON contents(state);
CREATE INDEX contents_owner_user_id_idx ON contents(owner_user_id);
CREATE INDEX contents_creator_id_idx ON contents(creator_id);
CREATE INDEX contents_ip_id_idx ON contents(ip_id);
CREATE INDEX contents_updated_at_idx ON contents(updated_at);
CREATE INDEX contents_state_updated_at_id_idx ON contents(state, updated_at, id);

CREATE TABLE content_mutation_idempotency (
  id TEXT NOT NULL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(owner_user_id, operation_id, idempotency_key)
);

CREATE INDEX content_mutation_idempotency_expiry_idx
  ON content_mutation_idempotency(expires_at);

CREATE TABLE content_outbox_events (
  event_id TEXT NOT NULL PRIMARY KEY,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX content_outbox_events_content_idx
  ON content_outbox_events(content_id, aggregate_version);

CREATE INDEX content_outbox_events_unpublished_idx
  ON content_outbox_events(published_at, created_at);

-- Single-row fail-closed guard used inside D1 batch() mutations.
-- A CHECK failure rolls back the whole batch when the preceding DML
-- changes zero rows, preventing an idempotency/outbox record from
-- committing after a stale If-Match or missing resource.
CREATE TABLE content_txn_guard (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  successful INTEGER NOT NULL CHECK (successful = 1)
);

CREATE TRIGGER contents_after_insert_outbox
AFTER INSERT ON contents
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    'createContent',
    'content.created',
    NEW.id,
    NEW.version,
    json_object(
      'id', NEW.id,
      'state', NEW.state,
      'version', NEW.version,
      'etag', NEW.etag
    ),
    NEW.created_at,
    NULL
  );
END;

CREATE TRIGGER contents_after_update_outbox
AFTER UPDATE ON contents
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    CASE
      WHEN NEW.state = 'DELETED' THEN 'deleteContent'
      WHEN OLD.state <> NEW.state THEN 'transitionContentState'
      ELSE 'updateContent'
    END,
    CASE
      WHEN NEW.state = 'DELETED' THEN 'content.deleted'
      WHEN OLD.state <> NEW.state THEN 'content.state_changed'
      ELSE 'content.updated'
    END,
    NEW.id,
    NEW.version,
    json_object(
      'id', NEW.id,
      'fromState', OLD.state,
      'toState', NEW.state,
      'version', NEW.version,
      'etag', NEW.etag
    ),
    NEW.updated_at,
    NULL
  );
END;
