-- W05-owned PostgreSQL migration: transactional realtime event outbox.
-- Message mutations and read receipts enqueue durable events in the same transaction
-- as their authoritative Neon rows. Delivery is at-least-once; clients must be idempotent.
BEGIN;

CREATE TABLE social_messaging_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL REFERENCES social_conversations(conversation_id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'message.created', 'message.edited', 'message.recalled', 'conversation.read'
  )),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX ix_social_messaging_outbox_pending
  ON social_messaging_outbox(available_at, created_at, event_id)
  WHERE delivered_at IS NULL;

CREATE INDEX ix_social_messaging_outbox_delivered
  ON social_messaging_outbox(delivered_at)
  WHERE delivered_at IS NOT NULL;

CREATE FUNCTION enqueue_social_message_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_type_value TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type_value := 'message.created';
  ELSIF NEW.recalled_at IS DISTINCT FROM OLD.recalled_at AND NEW.recalled_at IS NOT NULL THEN
    event_type_value := 'message.recalled';
  ELSIF NEW.body IS DISTINCT FROM OLD.body OR NEW.attachments IS DISTINCT FROM OLD.attachments THEN
    event_type_value := 'message.edited';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO social_messaging_outbox (
    conversation_id, actor_user_id, event_type, payload, created_at
  ) VALUES (
    NEW.conversation_id,
    NEW.sender_user_id,
    event_type_value,
    jsonb_build_object(
      'message_id', NEW.message_id,
      'conversation_id', NEW.conversation_id,
      'sender_user_id', NEW.sender_user_id,
      'sequence', NEW.sequence::text,
      'body', NEW.body,
      'attachments', COALESCE(NEW.attachments, '[]'::jsonb),
      'created_at', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'edited_at', CASE WHEN NEW.edited_at IS NULL THEN NULL ELSE to_char(NEW.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'recalled_at', CASE WHEN NEW.recalled_at IS NULL THEN NULL ELSE to_char(NEW.recalled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
    ),
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_messages_realtime_outbox
AFTER INSERT OR UPDATE OF body, attachments, recalled_at
ON social_messages
FOR EACH ROW
EXECUTE FUNCTION enqueue_social_message_realtime_event();

CREATE FUNCTION enqueue_social_read_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_read_sequence IS DISTINCT FROM OLD.last_read_sequence THEN
    INSERT INTO social_messaging_outbox (
      conversation_id, actor_user_id, event_type, payload, created_at
    ) VALUES (
      NEW.conversation_id,
      NEW.user_id,
      'conversation.read',
      jsonb_build_object('sequence', NEW.last_read_sequence::text),
      CURRENT_TIMESTAMP
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_conversation_read_realtime_outbox
AFTER UPDATE OF last_read_sequence
ON social_conversation_memberships
FOR EACH ROW
EXECUTE FUNCTION enqueue_social_read_realtime_event();

COMMENT ON TABLE social_messaging_outbox IS
  'Durable at-least-once realtime delivery queue; authoritative messages and read cursors remain in Neon source tables.';

COMMIT;
