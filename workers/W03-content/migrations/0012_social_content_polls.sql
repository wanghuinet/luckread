-- X-style polls attached to canonical social post content.
-- Content metadata remains in D1-02 / W03; binary media stays in W01 Media + R2.
CREATE TABLE content_polls (
  content_id TEXT NOT NULL PRIMARY KEY REFERENCES contents(id) ON DELETE CASCADE,
  options_json TEXT NOT NULL,
  duration_hours INTEGER NOT NULL CHECK (duration_hours IN (1, 24, 168)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE content_poll_votes (
  content_id TEXT NOT NULL REFERENCES content_polls(content_id) ON DELETE CASCADE,
  voter_user_id TEXT NOT NULL,
  option_index INTEGER NOT NULL CHECK (option_index >= 0 AND option_index <= 3),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (content_id, voter_user_id)
);

CREATE INDEX content_poll_votes_content_idx
  ON content_poll_votes(content_id);

CREATE INDEX content_poll_votes_option_idx
  ON content_poll_votes(content_id, option_index);
