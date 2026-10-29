-- Membership-gated access marker for W03-owned content.
-- This is source-only until the controlled D1-02 migration gate and postflight
-- admit the exact physical database. Public access is the compatibility default.
ALTER TABLE contents
  ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'PUBLIC'
  CHECK (access_mode IN ('PUBLIC', 'MEMBERS_ONLY'));

ALTER TABLE content_revisions
  ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'PUBLIC'
  CHECK (access_mode IN ('PUBLIC', 'MEMBERS_ONLY'));
