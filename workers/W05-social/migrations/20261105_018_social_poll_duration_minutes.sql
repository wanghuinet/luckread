-- MIG-SOCIAL-016-POLL-DURATION-MINUTES
-- W05 / D1-02 remains the sole poll and vote authority.
-- Preserve all existing polls while moving the canonical duration unit from hours to minutes.
DROP INDEX IF EXISTS ix_social_polls_owner_updated;

ALTER TABLE social_polls RENAME TO social_polls_legacy;

CREATE TABLE social_polls (
  poll_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 10080),
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO social_polls (
  poll_id, content_id, owner_user_id, duration_minutes, ends_at, created_at, updated_at
)
SELECT
  poll_id, content_id, owner_user_id, duration_hours * 60, ends_at, created_at, updated_at
FROM social_polls_legacy;

DROP TABLE social_polls_legacy;

CREATE INDEX IF NOT EXISTS ix_social_polls_owner_updated
  ON social_polls (owner_user_id, updated_at);
