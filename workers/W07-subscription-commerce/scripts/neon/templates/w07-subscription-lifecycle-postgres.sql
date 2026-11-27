-- W07 D1-01 subscription lifecycle incremental schema migration.
-- Adds pause snapshots, idempotent lifecycle receipts and append-only audit events.
-- D1-04 payment/order facts remain outside this database.
BEGIN;

ALTER TABLE membership_subscriptions
  ADD COLUMN pause_started_at TIMESTAMPTZ,
  ADD COLUMN pause_period_end_snapshot TIMESTAMPTZ,
  ADD COLUMN pause_remaining_seconds BIGINT,
  ADD CONSTRAINT membership_subscriptions_pause_snapshot_check CHECK (
    (pause_started_at IS NULL AND pause_period_end_snapshot IS NULL AND pause_remaining_seconds IS NULL)
    OR
    (pause_started_at IS NOT NULL AND pause_period_end_snapshot IS NOT NULL
      AND pause_remaining_seconds IS NOT NULL AND pause_remaining_seconds >= 0)
  );

CREATE TABLE membership_subscription_lifecycle_operation_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  subscription_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CANCEL', 'PAUSE', 'RESUME')),
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  expected_subscription_version INTEGER NOT NULL CHECK (expected_subscription_version > 0),
  result_subscription_version INTEGER NOT NULL CHECK (result_subscription_version > 0),
  result_status TEXT NOT NULL,
  response_json JSONB NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT membership_subscription_lifecycle_receipt_completion_check CHECK (completed_at >= created_at)
);
CREATE UNIQUE INDEX ux_membership_lifecycle_receipts_subscriber_idempotency
  ON membership_subscription_lifecycle_operation_receipts (subscriber_id, idempotency_key_hash);
CREATE INDEX ix_membership_lifecycle_receipts_subscription_created
  ON membership_subscription_lifecycle_operation_receipts (subscription_id, created_at);

CREATE TABLE membership_subscription_lifecycle_audit (
  event_id TEXT PRIMARY KEY NOT NULL,
  subscription_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CANCEL', 'PAUSE', 'RESUME', 'PAUSE_RECONCILIATION')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_subscription_version INTEGER,
  to_subscription_version INTEGER NOT NULL CHECK (to_subscription_version > 0),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT membership_subscription_lifecycle_audit_version_check CHECK (
    from_subscription_version IS NULL OR to_subscription_version >= from_subscription_version
  )
);
CREATE INDEX ix_membership_lifecycle_audit_subscription_time
  ON membership_subscription_lifecycle_audit (subscription_id, occurred_at, event_id);
CREATE INDEX ix_membership_lifecycle_audit_subscriber_time
  ON membership_subscription_lifecycle_audit (subscriber_id, occurred_at DESC);

CREATE FUNCTION w07_reject_subscription_lifecycle_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription lifecycle audit is append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER membership_subscription_lifecycle_audit_no_update_delete
BEFORE UPDATE OR DELETE ON membership_subscription_lifecycle_audit
FOR EACH ROW EXECUTE FUNCTION w07_reject_subscription_lifecycle_audit_mutation();

CREATE FUNCTION w07_reject_subscription_lifecycle_audit_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription lifecycle audit cannot be truncated'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER membership_subscription_lifecycle_audit_no_truncate
BEFORE TRUNCATE ON membership_subscription_lifecycle_audit
FOR EACH STATEMENT EXECUTE FUNCTION w07_reject_subscription_lifecycle_audit_truncate();

COMMIT;
