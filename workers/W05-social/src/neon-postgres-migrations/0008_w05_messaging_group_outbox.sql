-- W05-owned PostgreSQL migration: transactional group membership realtime events.
-- The mutation actor is supplied by W05 inside the same transaction via set_config(..., true).
BEGIN;

ALTER TABLE social_messaging_outbox
  DROP CONSTRAINT social_messaging_outbox_event_type_check;

ALTER TABLE social_messaging_outbox
  ADD CONSTRAINT social_messaging_outbox_event_type_check
  CHECK (event_type IN (
    'message.created', 'message.edited', 'message.recalled', 'conversation.read',
    'group.member.added', 'group.member.removed', 'group.member.left', 'group.owner.transferred'
  ));

CREATE FUNCTION enqueue_social_group_membership_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_user_id_value TEXT;
  conversation_type_value TEXT;
  conversation_created_at TIMESTAMPTZ;
  event_type_value TEXT;
  event_payload JSONB;
BEGIN
  SELECT conversation_type, created_at
    INTO conversation_type_value, conversation_created_at
    FROM social_conversations
   WHERE conversation_id = NEW.conversation_id;

  -- Group creation has no connected room yet; do not enqueue its initial roster.
  IF conversation_type_value IS DISTINCT FROM 'group'
     OR conversation_created_at >= transaction_timestamp() THEN
    RETURN NEW;
  END IF;

  actor_user_id_value := NULLIF(current_setting('luckread.actor_user_id', true), '');
  IF actor_user_id_value IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    event_type_value := 'group.member.added';
    event_payload := jsonb_build_object('memberUserIds', jsonb_build_array(NEW.user_id));
  ELSIF NEW.left_at IS DISTINCT FROM OLD.left_at AND NEW.left_at IS NOT NULL THEN
    IF actor_user_id_value = NEW.user_id THEN
      event_type_value := 'group.member.left';
    ELSE
      event_type_value := 'group.member.removed';
    END IF;
    event_payload := jsonb_build_object('memberUserId', NEW.user_id);
  ELSIF NEW.left_at IS DISTINCT FROM OLD.left_at AND NEW.left_at IS NULL THEN
    event_type_value := 'group.member.added';
    event_payload := jsonb_build_object('memberUserIds', jsonb_build_array(NEW.user_id));
  ELSIF NEW.member_role IS DISTINCT FROM OLD.member_role AND NEW.member_role = 'owner' THEN
    event_type_value := 'group.owner.transferred';
    event_payload := jsonb_build_object('targetUserId', NEW.user_id);
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO social_messaging_outbox (
    conversation_id, actor_user_id, event_type, payload, created_at
  ) VALUES (
    NEW.conversation_id,
    actor_user_id_value,
    event_type_value,
    event_payload,
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_group_membership_realtime_outbox
AFTER INSERT OR UPDATE OF left_at, member_role
ON social_conversation_memberships
FOR EACH ROW
EXECUTE FUNCTION enqueue_social_group_membership_realtime_event();

COMMENT ON FUNCTION enqueue_social_group_membership_realtime_event() IS
  'Enqueues group membership events atomically; actor identity comes only from transaction-local W05 context.';

COMMIT;
