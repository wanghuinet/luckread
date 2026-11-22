-- W05-owned PostgreSQL migration: bounded group conversations.
-- Direct conversations retain their canonical pair key and existing access policy.
BEGIN;

-- PostgreSQL derives this name from the table and column for the inline CHECK in 0002.
ALTER TABLE social_conversations
  DROP CONSTRAINT social_conversations_conversation_type_check;

ALTER TABLE social_conversations
  ADD CONSTRAINT social_conversations_conversation_type_check
  CHECK (conversation_type IN ('direct', 'group'));

ALTER TABLE social_conversations
  ALTER COLUMN direct_pair_key DROP NOT NULL;

ALTER TABLE social_conversations
  DROP CONSTRAINT social_conversations_direct_pair_key_key;

CREATE UNIQUE INDEX ux_social_conversations_direct_pair_key
  ON social_conversations(direct_pair_key)
  WHERE conversation_type = 'direct' AND direct_pair_key IS NOT NULL;

ALTER TABLE social_conversations
  ADD COLUMN group_name TEXT;

ALTER TABLE social_conversations
  ADD CONSTRAINT social_conversations_group_name_check
  CHECK (
    (conversation_type = 'direct' AND group_name IS NULL)
    OR
    (conversation_type = 'group' AND group_name IS NOT NULL AND char_length(btrim(group_name)) BETWEEN 1 AND 80)
  );

CREATE INDEX ix_social_conversation_memberships_active
  ON social_conversation_memberships(conversation_id, user_id)
  WHERE left_at IS NULL;

COMMENT ON COLUMN social_conversations.group_name IS
  'Display name for group conversations; null for canonical one-to-one direct conversations.';

COMMIT;
