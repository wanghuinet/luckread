-- 1.1 content canonical reference groundwork.
-- W03/D1-02 remains authoritative; slug is immutable after content creation.
-- The slug is derived from title + content id and therefore never needs a
-- second D1 uniqueness read during authoritative mutations.

ALTER TABLE contents ADD COLUMN slug TEXT NOT NULL DEFAULT '';
UPDATE contents
   SET slug = 'content-' || replace(id, '-', '')
 WHERE slug = '';

CREATE UNIQUE INDEX contents_slug_unique_idx ON contents(slug);

ALTER TABLE content_revisions ADD COLUMN slug TEXT NOT NULL DEFAULT '';
UPDATE content_revisions
   SET slug = (
     SELECT c.slug
       FROM contents c
      WHERE c.id = content_revisions.content_id
   )
 WHERE slug = '';

CREATE INDEX content_revisions_content_slug_idx
  ON content_revisions(content_id, slug);

DROP TRIGGER contents_after_insert_outbox;
DROP TRIGGER contents_after_update_outbox;

CREATE TRIGGER contents_after_insert_outbox
AFTER INSERT ON contents
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))), 'createContent', 'content.created',
    NEW.id, NEW.version,
    json_object('id', NEW.id, 'slug', NEW.slug, 'state', NEW.state,
      'version', NEW.version, 'etag', NEW.etag),
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
    json_object('id', NEW.id, 'slug', NEW.slug, 'fromState', OLD.state,
      'toState', NEW.state, 'version', NEW.version, 'etag', NEW.etag),
    NEW.updated_at, NULL
  );
END;
