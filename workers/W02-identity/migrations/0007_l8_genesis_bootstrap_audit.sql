-- Authority: docs/change-control/CC-L8-GENESIS-BOOTSTRAP-OUT-OF-BAND-APPROVAL-2026-10-24.md
-- This singleton row is both the durable audit record and the replay/concurrency guard.
-- A successful genesis bootstrap consumes this path permanently, even after the
-- four-hour RoleAssignment expires. There is intentionally no delete/reset API.

CREATE TABLE l8_genesis_bootstrap_audit (
  bootstrap_key TEXT NOT NULL PRIMARY KEY CHECK (bootstrap_key = 'first-l8'),
  operation TEXT NOT NULL CHECK (operation = 'INITIAL_L8_BOOTSTRAP'),
  request_pr_number INTEGER NOT NULL CHECK (request_pr_number > 0),
  request_head_sha TEXT NOT NULL,
  request_merge_sha TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  role_assignment_id TEXT NOT NULL UNIQUE,
  nonce_sha256 TEXT NOT NULL UNIQUE,
  approved_reviewers_json TEXT NOT NULL,
  reviewer_permissions_json TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (valid_until > valid_from)
);

CREATE INDEX l8_genesis_bootstrap_audit_target_idx
  ON l8_genesis_bootstrap_audit(target_user_id);
