-- MIG-SOCIAL-018-POLL-DURATION-MINUTES
-- W05 / D1-02 remains the sole poll and vote authority.
-- Add the canonical minute field without removing the legacy hour field so
-- currently deployed W05 versions remain compatible during rolling rollout.
ALTER TABLE social_polls
  ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 1440
  CHECK (duration_minutes BETWEEN 5 AND 10080);

-- Preserve each existing poll's configured duration exactly.
UPDATE social_polls
   SET duration_minutes = duration_hours * 60;
