-- 1.1 content revision history.
-- D1-02 / W03 remains the authoritative owner of current content and
-- immutable historical snapshots. No new Worker or D1 domain is introduced.

CREATE TABLE content_revisions (
  id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  content_version INTEGER NOT NULL CHECK (content_version >= 1),
  actor_user_id TEXT NOT NULL,
  source_revision INTEGER,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE','UPDATE','ROLLBACK')),
  state TEXT NOT NULL CHECK (
    state IN ('DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
      'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED')
  ),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  body_ref TEXT NOT NULL,
  media_refs_json TEXT NOT NULL DEFAULT '[]',
  cover_ref TEXT,
  etag TEXT NOT NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(content_id, revision)
);

CREATE INDEX content_revisions_content_created_idx
  ON content_revisions(content_id, created_at DESC, id DESC);

CREATE INDEX content_revisions_actor_created_idx
  ON content_revisions(actor_user_id, created_at DESC, id DESC);

-- Backfill revision 1 for existing authoritative content rows.
INSERT INTO content_revisions (
  id, content_id, revision, content_version, actor_user_id, source_revision,
  operation, state, title, body_ref, media_refs_json, cover_ref, etag,
  reason, correlation_id, created_at
)
SELECT
  lower(hex(randomblob(16))),
  id,
  revision,
  version,
  owner_user_id,
  NULL,
  'CREATE',
  state,
  title,
  body_ref,
  COALESCE(media_refs_json, '[]'),
  cover_ref,
  etag,
  'legacy_backfill',
  'migration:0004',
  created_at
FROM contents
WHERE NOT EXISTS (
  SELECT 1 FROM content_revisions r
  WHERE r.content_id = contents.id AND r.revision = contents.revision
);
