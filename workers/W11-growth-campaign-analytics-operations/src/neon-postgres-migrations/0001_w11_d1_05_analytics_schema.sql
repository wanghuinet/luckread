-- GENERATED FILE. Edit the template, not this artifact.
-- LuckRead D1-05 / W11 analytics-only PostgreSQL 18 schema baseline.
-- This is the final schema represented by the four admitted SQLite/D1 source migrations.
-- SQLite/D1 migration SQL is never executed on PostgreSQL.
-- Source Git blob SHA-1 pins:
--   0001_analytics_projection.sql             e957128a506ec21a1fa30c92ea062cc15dc83c23
--   0002_analytics_projection_rebuild_state.sql b4935dd6927c4410bc950744f2f7126f3ed9c076
--   0003_analytics_late_event_replay.sql       699f0f63cbef1a6a98e7163362e22d6fd9c6324d
--   0004_analytics_w01_client_telemetry.sql    d265bbb7b3eb8e56c5b9fd3c5a947d17d7f53db3
-- No identity/session fields, business authority, cross-domain foreign keys,
-- retention schedule, deletion workflow, consent policy, or runtime binding is added.
-- Retention/deletion/consent admission remains explicitly blocked in the schema contract.

BEGIN;

CREATE TABLE analytics_event_dedupe (
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
  source_worker TEXT NOT NULL CHECK (source_worker IN ('W01', 'W03', 'W05')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  hour_start TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'visitor')),
  content_id TEXT,
  content_type TEXT CHECK (content_type IS NULL OR content_type IN ('article', 'post', 'video')),
  creator_id TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000),
  position DOUBLE PRECISION CHECK (position IS NULL OR position BETWEEN 0 AND 100),
  metric_version TEXT NOT NULL CHECK (metric_version = '1.0'),
  projection_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (projection_status IN ('PENDING', 'APPLIED', 'LATE')),
  ingested_at TEXT NOT NULL DEFAULT (
    to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  CHECK (
    (event_name IN ('like_created', 'comment_created', 'share_created', 'favorite_created',
                    'follow_created', 'follow_removed') AND source_worker = 'W05')
    OR
    (event_name NOT IN ('like_created', 'comment_created', 'share_created', 'favorite_created',
                        'follow_created', 'follow_removed') AND source_worker IN ('W01', 'W03'))
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

CREATE INDEX analytics_event_dedupe_ingested_at_idx
  ON analytics_event_dedupe (ingested_at);
CREATE INDEX analytics_event_dedupe_occurred_at_idx
  ON analytics_event_dedupe (occurred_at);
CREATE INDEX analytics_event_dedupe_hour_start_idx
  ON analytics_event_dedupe (hour_start);
CREATE INDEX analytics_event_dedupe_pending_idx
  ON analytics_event_dedupe (projection_status, hour_start);

CREATE TABLE analytics_content_hourly (
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

CREATE INDEX analytics_content_hourly_content_time_idx
  ON analytics_content_hourly (content_type, content_id, hour_start);
CREATE INDEX analytics_content_hourly_content_id_time_idx
  ON analytics_content_hourly (content_id, hour_start);
CREATE INDEX analytics_content_hourly_time_idx
  ON analytics_content_hourly (hour_start);

CREATE TABLE analytics_creator_hourly (
  hour_start TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  metric_version TEXT NOT NULL,
  followers_gained INTEGER NOT NULL DEFAULT 0,
  followers_lost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, creator_id, metric_version)
);

CREATE INDEX analytics_creator_hourly_creator_time_idx
  ON analytics_creator_hourly (creator_id, hour_start);

CREATE TABLE analytics_rollup_watermark (
  consumer_name TEXT PRIMARY KEY NOT NULL,
  last_event_at TEXT,
  last_event_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (
    to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
);

CREATE TABLE analytics_reconciliation_status (
  reconciliation_id TEXT PRIMARY KEY NOT NULL,
  source_worker TEXT NOT NULL CHECK (source_worker IN ('W03', 'W05', 'W07')),
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'PASSED', 'FAILED')),
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (
    to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  updated_at TEXT NOT NULL DEFAULT (
    to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  CHECK (window_to >= window_from)
);

CREATE TABLE analytics_projection_rebuild_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  run_id TEXT NOT NULL,
  hour_start TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  content_buckets_rebuilt INTEGER CHECK (
    content_buckets_rebuilt IS NULL OR content_buckets_rebuilt >= 0
  ),
  creator_buckets_rebuilt INTEGER CHECK (
    creator_buckets_rebuilt IS NULL OR creator_buckets_rebuilt >= 0
  ),
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'REBUILD_FAILED', 'REBUILD_BATCH_INCOMPLETE', 'REBUILD_FINALIZE_FAILED'
  )),
  CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND error_code IS NULL)
    OR
    (status = 'SUCCEEDED' AND completed_at IS NOT NULL AND error_code IS NULL
      AND content_buckets_rebuilt IS NOT NULL AND creator_buckets_rebuilt IS NOT NULL)
    OR
    (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

COMMIT;
