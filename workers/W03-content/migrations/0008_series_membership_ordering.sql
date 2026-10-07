-- 1.1 Series membership / ordering extension.
-- Expands the existing relationship authority without adding a Worker or D1.
-- Existing content-reference rows are preserved unchanged.

CREATE TABLE content_relationships_v2 (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type = 'content'),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'series')),
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('reference', 'series-member')),
  position INTEGER,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'SUPERSEDED')),
  actor_id TEXT NOT NULL,
  provenance_ref TEXT,
  authorization_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (relation_type = 'reference' AND target_type = 'content' AND position IS NULL)
    OR
    (relation_type = 'series-member' AND target_type = 'series' AND position IS NOT NULL AND position >= 0)
  ),
  CHECK (source_id <> target_id)
);

INSERT INTO content_relationships_v2 (
  relationship_id, source_type, source_id, target_type, target_id, relation_type,
  position, schema_version, status, actor_id, provenance_ref, authorization_ref,
  created_at, updated_at
)
SELECT
  relationship_id, source_type, source_id, target_type, target_id, relation_type,
  NULL, schema_version, status, actor_id, provenance_ref, authorization_ref,
  created_at, updated_at
FROM content_relationships;

DROP TABLE content_relationships;
ALTER TABLE content_relationships_v2 RENAME TO content_relationships;

CREATE UNIQUE INDEX content_relationships_active_unique_idx
  ON content_relationships(source_type, source_id, target_type, target_id, relation_type)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX content_relationships_series_position_unique_idx
  ON content_relationships(target_id, position)
  WHERE status = 'ACTIVE' AND relation_type = 'series-member';

CREATE INDEX content_relationships_source_created_idx
  ON content_relationships(source_id, created_at DESC, relationship_id DESC);

CREATE INDEX content_relationships_target_created_idx
  ON content_relationships(target_id, created_at DESC, relationship_id DESC);

CREATE INDEX content_relationships_series_order_idx
  ON content_relationships(target_id, position ASC, relationship_id ASC)
  WHERE relation_type = 'series-member' AND status = 'ACTIVE';

CREATE TRIGGER content_relationships_after_insert_outbox
AFTER INSERT ON content_relationships
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    CASE
      WHEN NEW.relation_type = 'series-member' THEN 'attachSeriesMember'
      ELSE 'createContentRelationship'
    END,
    CASE
      WHEN NEW.relation_type = 'series-member' THEN 'content.series.attached'
      ELSE 'content.relationship.created'
    END,
    NEW.source_id,
    COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1),
    json_object(
      'schemaVersion', '1.0',
      'relationshipId', NEW.relationship_id,
      'sourceType', NEW.source_type,
      'sourceId', NEW.source_id,
      'targetType', NEW.target_type,
      'targetId', NEW.target_id,
      'relationType', NEW.relation_type,
      'position', NEW.position,
      'status', NEW.status
    ),
    NEW.created_at,
    NULL
  );
END;

CREATE TRIGGER content_relationships_after_update_outbox
AFTER UPDATE ON content_relationships
WHEN OLD.status <> NEW.status OR COALESCE(OLD.position, -1) <> COALESCE(NEW.position, -1)
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    CASE
      WHEN NEW.status = 'REVOKED' THEN 'revokeContentRelationship'
      WHEN NEW.relation_type = 'series-member' AND COALESCE(OLD.position, -1) <> COALESCE(NEW.position, -1) THEN 'reorderSeriesMember'
      ELSE 'updateContentRelationship'
    END,
    CASE
      WHEN NEW.status = 'REVOKED' THEN 'content.relationship.revoked'
      ELSE 'content.relationship.updated'
    END,
    NEW.source_id,
    COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1),
    json_object(
      'schemaVersion', '1.0',
      'relationshipId', NEW.relationship_id,
      'sourceType', NEW.source_type,
      'sourceId', NEW.source_id,
      'targetType', NEW.target_type,
      'targetId', NEW.target_id,
      'relationType', NEW.relation_type,
      'position', NEW.position,
      'status', NEW.status
    ),
    NEW.updated_at,
    NULL
  );
END;
