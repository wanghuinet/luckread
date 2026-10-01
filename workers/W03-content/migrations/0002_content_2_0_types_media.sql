-- 2.0 content media/type extension.
-- Keeps the existing D1-02 authoritative content table and adds the minimum
-- fields needed for article, dynamic post, image+text and video publication.
CREATE TABLE contents_v2 (
  id TEXT NOT NULL PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('article','post','video')),
  owner_user_id TEXT NOT NULL,
  creator_id TEXT,
  ip_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
      'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED')
  ),
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  body_ref TEXT NOT NULL,
  media_refs_json TEXT NOT NULL DEFAULT '[]',
  cover_ref TEXT,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO contents_v2 (
  id, content_type, owner_user_id, creator_id, ip_id, state, version, revision,
  title, body_ref, media_refs_json, cover_ref, etag, created_at, updated_at
)
SELECT id, content_type, owner_user_id, creator_id, ip_id, state, version, revision,
  title, body_ref, '[]', NULL, etag, created_at, updated_at
FROM contents;

DROP TABLE contents;
ALTER TABLE contents_v2 RENAME TO contents;

CREATE INDEX contents_state_idx ON contents(state);
CREATE INDEX contents_owner_user_id_idx ON contents(owner_user_id);
CREATE INDEX contents_creator_id_idx ON contents(creator_id);
CREATE INDEX contents_ip_id_idx ON contents(ip_id);
CREATE INDEX contents_updated_at_idx ON contents(updated_at);
CREATE INDEX contents_state_updated_at_id_idx ON contents(state, updated_at, id);

CREATE TRIGGER contents_after_insert_outbox
AFTER INSERT ON contents
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))), 'createContent', 'content.created',
    NEW.id, NEW.version,
    json_object('id', NEW.id, 'state', NEW.state, 'version', NEW.version, 'etag', NEW.etag),
    NEW.created_at, NULL
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
    NEW.id, NEW.version,
    json_object('id', NEW.id, 'fromState', OLD.state, 'toState', NEW.state,
      'version', NEW.version, 'etag', NEW.etag),
    NEW.updated_at, NULL
  );
END;
