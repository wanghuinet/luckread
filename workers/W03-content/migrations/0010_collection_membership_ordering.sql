-- 1.1 Collection membership / ordering extension.
-- Expands the existing relationship authority without adding a Worker or D1.
-- Preserves existing content-reference and series-member rows.

CREATE TABLE content_relationships_v3 (
  relationship_id TEXT NOT NULL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type = 'content'),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content', 'series', 'collection')),
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('reference', 'series-member', 'collection-member')),
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
    OR
    (relation_type = 'collection-member' AND target_type = 'collection' AND position IS NOT NULL AND position >= 0)
  ),
  CHECK (source_type <> target_type OR source_id <> target_id)
);

INSERT INTO content_relationships_v3 (
  relationship_id, source_type, source_id, target_type, target_id, relation_type,
  position, schema_version, status, actor_id, provenance_ref, authorization_ref,
  created_at, updated_at
)
SELECT
  relationship_id, source_type, source_id, target_type, target_id, relation_type,
  position, schema_version, status, actor_id, provenance_ref, authorization_ref,
  created_at, updated_at
FROM content_relationships;

DROP TABLE content_relationships;
ALTER TABLE content_relationships_v3 RENAME TO content_relationships;

CREATE UNIQUE INDEX content_relationships_active_unique_idx
  ON content_relationships(source_type, source_id, target_type, target_id, relation_type)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX content_relationships_series_position_unique_idx
  ON content_relationships(target_id, position)
  WHERE status = 'ACTIVE' AND relation_type = 'series-member';

CREATE UNIQUE INDEX content_relationships_collection_position_unique_idx
  ON content_relationships(target_id, position)
  WHERE status = 'ACTIVE' AND relation_type = 'collection-member';

CREATE INDEX content_relationships_source_created_idx
  ON content_relationships(source_id, created_at DESC, relationship_id DESC);

CREATE INDEX content_relationships_target_created_idx
  ON content_relationships(target_id, created_at DESC, relationship_id DESC);

CREATE INDEX content_relationships_series_order_idx
  ON content_relationships(target_id, position ASC, relationship_id ASC)
  WHERE relation_type = 'series-member' AND status = 'ACTIVE';

CREATE INDEX content_relationships_collection_order_idx
  ON content_relationships(target_id, position ASC, relationship_id ASC)
  WHERE relation_type = 'collection-member' AND status = 'ACTIVE';

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
      WHEN NEW.relation_type = 'collection-member' THEN 'attachCollectionMember'
      ELSE 'createContentRelationship'
    END,
    CASE
      WHEN NEW.relation_type = 'series-member' THEN 'content.series.attached'
      WHEN NEW.relation_type = 'collection-member' THEN 'content.collection.attached'
      ELSE 'content.relationship.created'
    END,
    NEW.source_id,
    CASE
      WHEN NEW.relation_type = 'series-member'
        THEN COALESCE((SELECT version FROM content_series WHERE id = NEW.target_id), 1)
      WHEN NEW.relation_type = 'collection-member'
        THEN COALESCE((SELECT version FROM content_collections WHERE id = NEW.target_id), 1)
      ELSE COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1)
    END,
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
      WHEN NEW.relation_type = 'collection-member' AND COALESCE(OLD.position, -1) <> COALESCE(NEW.position, -1) THEN 'reorderCollectionMember'
      ELSE 'updateContentRelationship'
    END,
    CASE
      WHEN NEW.status = 'REVOKED' THEN 'content.relationship.revoked'
      ELSE 'content.relationship.updated'
    END,
    NEW.source_id,
    CASE
      WHEN NEW.relation_type = 'series-member'
        THEN COALESCE((SELECT version FROM content_series WHERE id = NEW.target_id), 1)
      WHEN NEW.relation_type = 'collection-member'
        THEN COALESCE((SELECT version FROM content_collections WHERE id = NEW.target_id), 1)
      ELSE COALESCE((SELECT version FROM contents WHERE id = NEW.source_id), 1)
    END,
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
