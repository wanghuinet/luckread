-- Membership-gated access marker for W03-owned content.
-- This is source-only until the controlled D1-02 migration gate and postflight
-- admit the exact physical database. Public access is the compatibility default.
ALTER TABLE contents
  ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'PUBLIC'
  CHECK (access_mode IN ('PUBLIC', 'MEMBERS_ONLY'));

ALTER TABLE content_revisions
  ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'PUBLIC'
  CHECK (access_mode IN ('PUBLIC', 'MEMBERS_ONLY'));

-- A paywall change must carry explicit invalidation/event evidence. The existing
-- content.updated event remains backward compatible; this additional event lets
-- downstream access projections invalidate only the affected entitlement policy.
CREATE TRIGGER IF NOT EXISTS contents_after_access_mode_update_outbox
AFTER UPDATE OF access_mode ON contents
WHEN OLD.access_mode <> NEW.access_mode
BEGIN
  INSERT INTO content_outbox_events (
    event_id, operation_id, event_type, content_id, aggregate_version,
    payload_json, created_at, published_at
  ) VALUES (
    lower(hex(randomblob(16))),
    'updateContentAccessPolicy',
    'content.access_policy_changed',
    NEW.id,
    NEW.version,
    json_object(
      'schemaVersion', '1.0',
      'producer', 'W03',
      'contentId', NEW.id,
      'accessMode', NEW.access_mode,
      'contentVersion', NEW.version,
      'correlationId', 'database-trigger'
    ),
    NEW.updated_at,
    NULL
  );
END;
