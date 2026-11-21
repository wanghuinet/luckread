-- W11 / D1-05: durably quarantine late analytics events without projecting them.
-- A LATE event keeps its event ID and dedupe key in the canonical ledger, but does
-- not enter live projections until an explicit hour-scoped replay is requested.
-- This migration only widens the status check; it does not rewrite business facts.

CREATE TABLE analytics_event_dedupe_new (
  event_id TEXT PRIMARY KEY NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
  event_name TEXT NOT NULL CHECK (event_name IN (
    'content_impression', 'content_open', 'read_start',
    'read_progress_25', 'read_progress_50', 'read_progress_75', 'read_complete', 'read_dwell',
    'dwell', 'complete_view',
    'video_impression', 'video_play_request', 'video_play_success',
    'video_progress_25', 'video_progress_50', 'video_progress_75', 'video_progress_90',
    'video_complete', 'video_replay', 'video_watch',
    'like_created', 'comment_created', 'share_created', 'favorite_created',
    'follow_created', 'follow_removed'
  )),
  source_worker TEXT NOT NULL CHECK (source_worker IN ('W03', 'W05')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  hour_start TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'visitor')),
  content_id TEXT,
  content_type TEXT CHECK (content_type IS NULL OR content_type IN ('article', 'post', 'video')),
  creator_id TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000),
  position REAL CHECK (position IS NULL OR position BETWEEN 0 AND 100),
  metric_version TEXT NOT NULL CHECK (metric_version = '1.0'),
  projection_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (projection_status IN ('PENDING', 'APPLIED', 'LATE')),
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (event_name IN ('like_created', 'comment_created', 'share_created', 'favorite_created',
                    'follow_created', 'follow_removed') AND source_worker = 'W05')
    OR
    (event_name NOT IN ('like_created', 'comment_created', 'share_created', 'favorite_created',
                        'follow_created', 'follow_removed') AND source_worker = 'W03')
  ),
  CHECK (
    (event_name IN ('follow_created', 'follow_removed') AND creator_id IS NOT NULL)
    OR
    (event_name NOT IN ('follow_created', 'follow_removed')
      AND content_id IS NOT NULL AND content_type IS NOT NULL)
  ),
  CHECK (
    (
      event_name IN ('read_dwell', 'dwell', 'video_watch')
      AND duration_ms IS NOT NULL
      AND duration_ms BETWEEN 1 AND 86400000
    )
    OR (
      event_name NOT IN ('read_dwell', 'dwell', 'video_watch')
      AND duration_ms IS NULL
    )
  ),
  CHECK (
    event_name NOT IN ('like_created', 'comment_created', 'share_created', 'favorite_created',
                       'follow_created', 'follow_removed')
    OR actor_type = 'user'
  )
);

INSERT INTO analytics_event_dedupe_new (
  event_id, dedupe_key, schema_version, event_name, source_worker,
  occurred_at, received_at, hour_start, actor_type, content_id, content_type,
  creator_id, duration_ms, position, metric_version, projection_status, ingested_at
)
SELECT
  event_id, dedupe_key, schema_version, event_name, source_worker,
  occurred_at, received_at, hour_start, actor_type, content_id, content_type,
  creator_id, duration_ms, position, metric_version, projection_status, ingested_at
FROM analytics_event_dedupe;

DROP TABLE analytics_event_dedupe;
ALTER TABLE analytics_event_dedupe_new RENAME TO analytics_event_dedupe;

CREATE INDEX analytics_event_dedupe_ingested_at_idx
  ON analytics_event_dedupe (ingested_at);
CREATE INDEX analytics_event_dedupe_occurred_at_idx
  ON analytics_event_dedupe (occurred_at);
CREATE INDEX analytics_event_dedupe_hour_start_idx
  ON analytics_event_dedupe (hour_start);
CREATE INDEX analytics_event_dedupe_pending_idx
  ON analytics_event_dedupe (projection_status, hour_start);
