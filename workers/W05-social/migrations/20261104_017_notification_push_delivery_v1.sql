-- NOTIFY-003: durable Expo push delivery for W05-owned social notifications.
-- D1-02 remains authoritative for the notification inbox and delivery intent.
-- D1-03 is read only for W05's scoped NotificationPushEndpoint delegation.
CREATE TABLE IF NOT EXISTS social_notification_push_outbox (
  notification_id TEXT NOT NULL PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','FANNED_OUT','NO_ENDPOINT')),
  endpoint_count INTEGER NOT NULL DEFAULT 0 CHECK (endpoint_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_social_notification_push_outbox_status_created
  ON social_notification_push_outbox (status, created_at, notification_id);
CREATE TABLE IF NOT EXISTS social_notification_push_deliveries (
  delivery_id TEXT NOT NULL PRIMARY KEY,
  notification_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','LEASED','RECEIPT_PENDING','RECEIPT_LEASED','DELIVERED','RETRY','FAILED','CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  receipt_poll_count INTEGER NOT NULL DEFAULT 0 CHECK (receipt_poll_count >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  expo_ticket_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (notification_id, endpoint_id)
);
CREATE INDEX IF NOT EXISTS ix_social_notification_push_deliveries_due
  ON social_notification_push_deliveries (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS ix_social_notification_push_deliveries_endpoint
  ON social_notification_push_deliveries (endpoint_id, status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_notification_push_ticket
  ON social_notification_push_deliveries (expo_ticket_id)
  WHERE expo_ticket_id IS NOT NULL;
-- Same-D1 transaction: no cross-D1 outbox dual-write gap. Existing notifications are not backfilled.
CREATE TRIGGER IF NOT EXISTS trg_social_notifications_push_outbox_insert
AFTER INSERT ON social_notifications
BEGIN
  INSERT OR IGNORE INTO social_notification_push_outbox
    (notification_id, recipient_user_id, status, endpoint_count, created_at, updated_at)
  VALUES
    (NEW.notification_id, NEW.recipient_user_id, 'PENDING', 0, NEW.created_at, NEW.created_at);
END;
