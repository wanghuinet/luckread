-- 1.1 content relationship authority.
-- W03/D1-02 owns authoritative content-to-content relations.
-- Reusable by related content, references, derivatives and future
-- series/collection bindings without a new Worker or D1.

CREATE TABLE content_relationships (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type = 'content'),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'content'),
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type = 'reference'),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'SUPERSEDED')),
  actor_id TEXT NOT NULL,
  provenance_ref TEXT,
  authorization_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_id <> target_id)
);

CREATE UNIQUE INDEX content_relationships_active_unique_idx
  ON content_relationships(source_type, source_id, target_type, target_id, relation_type)
  WHERE status = 'ACTIVE';

CREATE INDEX content_relationships_source_created_idx
  ON content_relationships(source_id, created_at DESC, relationship_id DESC);

CREATE INDEX content_relationships_target_created_idx
  ON content_relationships(target_id, created_at DESC, relationship_id DESC);

CREATE TRIGGER content_relationships_after_insert_outbox
AFTER INSERT ON content_relationships
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    'createContentRelationship',
    'content.relationship.created',
    NEW.source_id,
    COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1),
    json_object(
      'relationshipId', NEW.relationship_id,
      'sourceType', NEW.source_type,
      'sourceId', NEW.source_id,
      'targetType', NEW.target_type,
      'targetId', NEW.target_id,
      'relationType', NEW.relation_type,
      'schemaVersion', NEW.schema_version,
      'status', NEW.status
    ),
    NEW.created_at,
    NULL
  );
END;

CREATE TRIGGER content_relationships_after_update_outbox
AFTER UPDATE ON content_relationships
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    CASE
      WHEN NEW.status = 'REVOKED' THEN 'revokeContentRelationship'
      ELSE 'updateContentRelationship'
    END,
    CASE
      WHEN NEW.status = 'REVOKED' THEN 'content.relationship.revoked'
      ELSE 'content.relationship.updated'
    END,
    NEW.source_id,
    COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1),
    json_object(
      'relationshipId', NEW.relationship_id,
      'sourceType', NEW.source_type,
      'sourceId', NEW.source_id,
      'targetType', NEW.target_type,
      'targetId', NEW.target_id,
      'relationType', NEW.relation_type,
      'schemaVersion', NEW.schema_version,
      'status', NEW.status
    ),
    NEW.updated_at,
    NULL
  );
END;
