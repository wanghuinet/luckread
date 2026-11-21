-- W05-owned PostgreSQL migration: direct message requests.
-- Pending requests do not create a conversation or expose the sender's history.
BEGIN;
CREATE TABLE social_message_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  sender_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  initial_message TEXT NOT NULL CHECK (char_length(initial_message) BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  conversation_id TEXT REFERENCES social_conversations(conversation_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMPTZ,
  CHECK (sender_user_id <> recipient_user_id),
  UNIQUE (sender_user_id, client_request_id)
);
CREATE UNIQUE INDEX ux_social_message_requests_pending_pair
  ON social_message_requests(sender_user_id, recipient_user_id)
  WHERE status = 'pending';
CREATE INDEX ix_social_message_requests_recipient_pending
  ON social_message_requests(recipient_user_id, created_at DESC, request_id DESC)
  WHERE status = 'pending';
CREATE INDEX ix_social_message_requests_sender
  ON social_message_requests(sender_user_id, created_at DESC, request_id DESC);
COMMIT;
