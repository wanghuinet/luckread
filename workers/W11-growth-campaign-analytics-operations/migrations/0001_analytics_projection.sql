-- W11 / D1-05: derived analytics only.
-- Apply only to the dedicated D1-05 resource after its physical binding is admitted.
-- Event inserts and hourly projections share one SQLite transaction via triggers;
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
    event_name IN ('read_dwell', 'dwell', 'video_watch')
    OR duration_ms IS NULL
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

CREATE TRIGGER IF NOT EXISTS analytics_event_dedupe_after_insert
AFTER INSERT ON analytics_event_dedupe
BEGIN
  INSERT OR IGNORE INTO analytics_content_hourly (
    hour_start, content_id, content_type, metric_version,
    impressions, opens, read_starts, read_progress_25, read_progress_50, read_progress_75,
    read_completions, read_duration_ms, read_duration_events, dwell_duration_ms, dwell_events,
    completed_views, video_impressions, video_play_requests, video_plays, video_progress_25,
    video_progress_50, video_progress_75, video_progress_90, video_completions, video_replays,
    video_watch_ms, video_watch_events, likes, comments, shares, favorites
  )
  SELECT
    NEW.hour_start, NEW.content_id, NEW.content_type, NEW.metric_version,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  WHERE NEW.event_name NOT IN ('follow_created', 'follow_removed');

  UPDATE analytics_content_hourly SET
    impressions = impressions + CASE WHEN NEW.event_name = 'content_impression' THEN 1 ELSE 0 END,
    opens = opens + CASE WHEN NEW.event_name = 'content_open' THEN 1 ELSE 0 END,
    read_starts = read_starts + CASE WHEN NEW.event_name = 'read_start' THEN 1 ELSE 0 END,
    read_progress_25 = read_progress_25 + CASE WHEN NEW.event_name = 'read_progress_25' THEN 1 ELSE 0 END,
    read_progress_50 = read_progress_50 + CASE WHEN NEW.event_name = 'read_progress_50' THEN 1 ELSE 0 END,
    read_progress_75 = read_progress_75 + CASE WHEN NEW.event_name = 'read_progress_75' THEN 1 ELSE 0 END,
    read_completions = read_completions + CASE WHEN NEW.event_name = 'read_complete' THEN 1 ELSE 0 END,
    read_duration_ms = read_duration_ms + CASE WHEN NEW.event_name = 'read_dwell' THEN COALESCE(NEW.duration_ms, 0) ELSE 0 END,
    read_duration_events = read_duration_events + CASE WHEN NEW.event_name = 'read_dwell' THEN 1 ELSE 0 END,
    dwell_duration_ms = dwell_duration_ms + CASE WHEN NEW.event_name = 'dwell' THEN COALESCE(NEW.duration_ms, 0) ELSE 0 END,
    dwell_events = dwell_events + CASE WHEN NEW.event_name = 'dwell' THEN 1 ELSE 0 END,
    completed_views = completed_views + CASE WHEN NEW.event_name = 'complete_view' THEN 1 ELSE 0 END,
    video_impressions = video_impressions + CASE WHEN NEW.event_name = 'video_impression' THEN 1 ELSE 0 END,
    video_play_requests = video_play_requests + CASE WHEN NEW.event_name = 'video_play_request' THEN 1 ELSE 0 END,
    video_plays = video_plays + CASE WHEN NEW.event_name = 'video_play_success' THEN 1 ELSE 0 END,
    video_progress_25 = video_progress_25 + CASE WHEN NEW.event_name = 'video_progress_25' THEN 1 ELSE 0 END,
    video_progress_50 = video_progress_50 + CASE WHEN NEW.event_name = 'video_progress_50' THEN 1 ELSE 0 END,
    video_progress_75 = video_progress_75 + CASE WHEN NEW.event_name = 'video_progress_75' THEN 1 ELSE 0 END,
    video_progress_90 = video_progress_90 + CASE WHEN NEW.event_name = 'video_progress_90' THEN 1 ELSE 0 END,
    video_completions = video_completions + CASE WHEN NEW.event_name = 'video_complete' THEN 1 ELSE 0 END,
    video_replays = video_replays + CASE WHEN NEW.event_name = 'video_replay' THEN 1 ELSE 0 END,
    video_watch_ms = video_watch_ms + CASE WHEN NEW.event_name = 'video_watch' THEN COALESCE(NEW.duration_ms, 0) ELSE 0 END,
    video_watch_events = video_watch_events + CASE WHEN NEW.event_name = 'video_watch' THEN 1 ELSE 0 END,
    likes = likes + CASE WHEN NEW.event_name = 'like_created' THEN 1 ELSE 0 END,
    comments = comments + CASE WHEN NEW.event_name = 'comment_created' THEN 1 ELSE 0 END,
    shares = shares + CASE WHEN NEW.event_name = 'share_created' THEN 1 ELSE 0 END,
    favorites = favorites + CASE WHEN NEW.event_name = 'favorite_created' THEN 1 ELSE 0 END
  WHERE hour_start = NEW.hour_start
    AND content_id = NEW.content_id
    AND content_type = NEW.content_type
    AND metric_version = NEW.metric_version
    AND NEW.event_name NOT IN ('follow_created', 'follow_removed');

  INSERT OR IGNORE INTO analytics_creator_hourly (
    hour_start, creator_id, metric_version, followers_gained, followers_lost
  )
  SELECT NEW.hour_start, NEW.creator_id, NEW.metric_version, 0, 0
  WHERE NEW.event_name IN ('follow_created', 'follow_removed');

  UPDATE analytics_creator_hourly SET
    followers_gained = followers_gained + CASE WHEN NEW.event_name = 'follow_created' THEN 1 ELSE 0 END,
    followers_lost = followers_lost + CASE WHEN NEW.event_name = 'follow_removed' THEN 1 ELSE 0 END
  WHERE hour_start = NEW.hour_start
    AND creator_id = NEW.creator_id
    AND metric_version = NEW.metric_version
    AND NEW.event_name IN ('follow_created', 'follow_removed');
END;
