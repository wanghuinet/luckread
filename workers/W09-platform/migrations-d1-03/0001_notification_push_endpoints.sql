-- MIG-NOTIFY-002-PUSH-ENDPOINTS-V1
-- W05 owns Expo push routing endpoints as scoped D1-03 runtime delivery state.
-- This migration must only run against D1-03 (database name: secondary).
CREATE TABLE IF NOT EXISTS notification_push_endpoints (
  endpoint_id TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'expo'),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  push_token TEXT,
  permission_status TEXT NOT NULL
    CHECK (permission_status IN ('granted', 'denied', 'undetermined')),
  app_version TEXT
    CHECK (app_version IS NULL OR length(app_version) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK (
    (permission_status = 'granted' AND push_token IS NOT NULL)
    OR
    (permission_status IN ('denied', 'undetermined') AND push_token IS NULL)
  ),
  CHECK (push_token IS NULL OR length(push_token) BETWEEN 20 AND 512)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_push_endpoints_provider_token
  ON notification_push_endpoints (provider, push_token)
  WHERE push_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_notification_push_endpoints_owner_status
  ON notification_push_endpoints (owner_user_id, permission_status, updated_at);
