-- W11 / D1-05: bounded singleton state for the most recent projection repair.
-- This stores operational status only, not source facts or event identities.
-- A singleton row avoids an unbounded job-history table without an approved retention policy.
CREATE TABLE IF NOT EXISTS analytics_projection_rebuild_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  run_id TEXT NOT NULL,
  hour_start TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  content_buckets_rebuilt INTEGER CHECK (content_buckets_rebuilt IS NULL OR content_buckets_rebuilt >= 0),
  creator_buckets_rebuilt INTEGER CHECK (creator_buckets_rebuilt IS NULL OR creator_buckets_rebuilt >= 0),
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
