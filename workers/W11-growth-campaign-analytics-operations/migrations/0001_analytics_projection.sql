-- W11 / D1-05: derived analytics only.
-- Target: D1-05 `allluck` (77d82be2-d12e-4a17-b410-9aa7d376bc11).
-- Applying this migration to the remote database remains a separate deployment operation.
-- Event inserts, grouped projections and status updates are applied in one D1 batch transaction;
-- duplicate event IDs or dedupe keys are ignored and never increment projections.

CREATE TABLE IF NOT EXISTS analytics_event_dedupe (
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
  projection_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (projection_status IN ('PENDING', 'APPLIED')),
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

CREATE INDEX IF NOT EXISTS analytics_event_dedupe_ingested_at_idx
  ON analytics_event_dedupe (ingested_at);

CREATE INDEX IF NOT EXISTS analytics_event_dedupe_occurred_at_idx
  ON analytics_event_dedupe (occurred_at);

CREATE TABLE IF NOT EXISTS analytics_content_hourly (
  hour_start TEXT NOT NULL,
  content_id TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('article', 'post', 'video')),
  metric_version TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  read_starts INTEGER NOT NULL DEFAULT 0,
  read_progress_25 INTEGER NOT NULL DEFAULT 0,
  read_progress_50 INTEGER NOT NULL DEFAULT 0,
  read_progress_75 INTEGER NOT NULL DEFAULT 0,
  read_completions INTEGER NOT NULL DEFAULT 0,
  read_duration_ms INTEGER NOT NULL DEFAULT 0,
  read_duration_events INTEGER NOT NULL DEFAULT 0,
  dwell_duration_ms INTEGER NOT NULL DEFAULT 0,
  dwell_events INTEGER NOT NULL DEFAULT 0,
  completed_views INTEGER NOT NULL DEFAULT 0,
  video_impressions INTEGER NOT NULL DEFAULT 0,
  video_play_requests INTEGER NOT NULL DEFAULT 0,
  video_plays INTEGER NOT NULL DEFAULT 0,
  video_progress_25 INTEGER NOT NULL DEFAULT 0,
  video_progress_50 INTEGER NOT NULL DEFAULT 0,
  video_progress_75 INTEGER NOT NULL DEFAULT 0,
  video_progress_90 INTEGER NOT NULL DEFAULT 0,
  video_completions INTEGER NOT NULL DEFAULT 0,
  video_replays INTEGER NOT NULL DEFAULT 0,
  video_watch_ms INTEGER NOT NULL DEFAULT 0,
  video_watch_events INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  favorites INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, content_type, content_id, metric_version)
);

CREATE INDEX IF NOT EXISTS analytics_content_hourly_content_time_idx
  ON analytics_content_hourly (content_type, content_id, hour_start);

CREATE INDEX IF NOT EXISTS analytics_content_hourly_time_idx
  ON analytics_content_hourly (hour_start);

CREATE TABLE IF NOT EXISTS analytics_creator_hourly (
  hour_start TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  metric_version TEXT NOT NULL,
  followers_gained INTEGER NOT NULL DEFAULT 0,
  followers_lost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, creator_id, metric_version)
);

CREATE INDEX IF NOT EXISTS analytics_creator_hourly_creator_time_idx
  ON analytics_creator_hourly (creator_id, hour_start);

CREATE TABLE IF NOT EXISTS analytics_rollup_watermark (
  consumer_name TEXT PRIMARY KEY NOT NULL,
  last_event_at TEXT,
  last_event_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS analytics_reconciliation_status (
  reconciliation_id TEXT PRIMARY KEY NOT NULL,
  source_worker TEXT NOT NULL CHECK (source_worker IN ('W03', 'W05', 'W07')),
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'PASSED', 'FAILED')),
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (window_to >= window_from)
);

CREATE INDEX IF NOT EXISTS analytics_event_dedupe_pending_idx
  ON analytics_event_dedupe (projection_status, hour_start);
