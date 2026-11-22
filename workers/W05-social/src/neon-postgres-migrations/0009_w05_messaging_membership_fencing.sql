-- W05-owned PostgreSQL migration: versioned conversation membership fencing.
-- Every membership activation/revocation/role transition advances a monotonic version.
BEGIN;

ALTER TABLE social_conversation_memberships
  ADD COLUMN membership_version BIGINT NOT NULL DEFAULT 1
  CHECK (membership_version > 0);

CREATE FUNCTION bump_social_conversation_membership_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.left_at IS DISTINCT FROM OLD.left_at
     OR NEW.member_role IS DISTINCT FROM OLD.member_role
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    NEW.membership_version := OLD.membership_version + 1;
  ELSE
    NEW.membership_version := OLD.membership_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_conversation_membership_version_bump
BEFORE UPDATE OF left_at, member_role, joined_at
ON social_conversation_memberships
FOR EACH ROW
EXECUTE FUNCTION bump_social_conversation_membership_version();

CREATE OR REPLACE FUNCTION enqueue_social_group_membership_realtime_event()
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
    event_payload := jsonb_build_object(
      'memberUserIds', jsonb_build_array(NEW.user_id),
      'membershipVersion', NEW.membership_version
    );
  ELSIF NEW.left_at IS DISTINCT FROM OLD.left_at AND NEW.left_at IS NOT NULL THEN
    IF actor_user_id_value = NEW.user_id THEN
      event_type_value := 'group.member.left';
    ELSE
      event_type_value := 'group.member.removed';
    END IF;
    event_payload := jsonb_build_object(
      'memberUserId', NEW.user_id,
      'membershipVersion', NEW.membership_version
    );
  ELSIF NEW.left_at IS DISTINCT FROM OLD.left_at AND NEW.left_at IS NULL THEN
    event_type_value := 'group.member.added';
    event_payload := jsonb_build_object(
      'memberUserIds', jsonb_build_array(NEW.user_id),
      'membershipVersion', NEW.membership_version
    );
  ELSIF NEW.member_role IS DISTINCT FROM OLD.member_role AND NEW.member_role = 'owner' THEN
    event_type_value := 'group.owner.transferred';
    event_payload := jsonb_build_object(
      'targetUserId', NEW.user_id,
      'membershipVersion', NEW.membership_version
    );
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

COMMENT ON COLUMN social_conversation_memberships.membership_version IS
  'Monotonic fencing token advanced on membership activation, revocation, and role changes; used to reject stale realtime sessions.';

COMMIT;
