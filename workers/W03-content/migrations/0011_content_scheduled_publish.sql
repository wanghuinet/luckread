-- Schedule metadata for the existing D1-02 content authority.
-- No new Worker/D1/Queue is introduced.
ALTER TABLE contents ADD COLUMN scheduled_at TEXT;

CREATE INDEX contents_scheduled_due_idx
  ON contents(state, scheduled_at, updated_at, id);
