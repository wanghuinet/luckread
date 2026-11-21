-- MIG-SOCIAL-014-POLL-V1
-- Authority: W05 / D1-02. Poll state and votes belong to the social domain;
-- canonical post identity and publication state remain owned by W03.
CREATE TABLE IF NOT EXISTS social_polls (
  poll_id TEXT NOT NULL PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  duration_hours INTEGER NOT NULL CHECK (duration_hours IN (24, 72, 168)),
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_social_polls_owner_updated
  ON social_polls (owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS social_poll_options (
  option_id TEXT NOT NULL PRIMARY KEY,
  poll_id TEXT NOT NULL,
  option_text TEXT NOT NULL CHECK (length(option_text) BETWEEN 1 AND 50),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  UNIQUE (poll_id, position),
  UNIQUE (poll_id, option_text)
);

CREATE INDEX IF NOT EXISTS ix_social_poll_options_poll_position
  ON social_poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS social_poll_votes (
  vote_id TEXT NOT NULL PRIMARY KEY,
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_social_poll_votes_option_created
  ON social_poll_votes (poll_id, option_id, created_at);
