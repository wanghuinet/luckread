-- W05-owned PostgreSQL migration: durable notification of committed messaging events.
-- Neon remains authoritative; this outbox only closes the post-commit / pre-DO-broadcast crash window.
BEGIN;

CREATE TABLE social_messaging_event_outbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'message.created', 'message.edited', 'message.recalled', 'conversation.read',
    'group.member.added', 'group.member.removed', 'group.member.left', 'group.owner.transferred'
  )),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error_code TEXT,
  CHECK (
    (delivered_at IS NULL OR failed_at IS NULL)
    AND ((lease_token IS NULL) = (lease_expires_at IS NULL))
  )
);

CREATE INDEX ix_social_messaging_event_outbox_due
  ON social_messaging_event_outbox(next_attempt_at, occurred_at, event_id)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

CREATE INDEX ix_social_messaging_event_outbox_retention
  ON social_messaging_event_outbox(delivered_at, failed_at)
  WHERE delivered_at IS NOT NULL OR failed_at IS NOT NULL;

COMMENT ON TABLE social_messaging_event_outbox IS
  'Transactional W05 event relay. Rows are inserted with the authoritative Neon mutation; DO broadcast is at-least-once and client sync remains authoritative.';

COMMIT;
