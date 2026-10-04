-- 1.1 content production: immutable revision history.
-- Authority: D1-02 / W03.
-- Revisions are content snapshots, not a second content authority.

CREATE TABLE content_revisions (
  revision_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  content_version INTEGER NOT NULL CHECK (content_version >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  body_ref TEXT NOT NULL,
  media_refs_json TEXT NOT NULL DEFAULT '[]',
  cover_ref TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
      'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED'
    )
  ),
  actor_user_id TEXT NOT NULL,
  source_revision_id TEXT,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(content_id, revision_number)
);

CREATE INDEX content_revisions_content_created_idx
  ON content_revisions(content_id, created_at DESC, revision_id DESC);

CREATE INDEX content_revisions_actor_idx
  ON content_revisions(actor_user_id, created_at DESC);

INSERT INTO content_revisions (
  revision_id, content_id, revision_number, content_version,
  title, body_ref, media_refs_json, cover_ref, state,
  actor_user_id, source_revision_id, reason, correlation_id, created_at
)
SELECT
  lower(hex(randomblob(16))),
  id,
  revision,
  version,
  title,
  body_ref,
  media_refs_json,
  cover_ref,
  state,
  owner_user_id,
  NULL,
  'migration-seed',
  lower(hex(randomblob(16))),
  created_at
FROM contents;
