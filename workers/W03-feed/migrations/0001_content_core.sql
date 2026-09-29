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
