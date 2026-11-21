-- W05-owned PostgreSQL migration: direct text messaging phase one.
-- Additive D1-02 schema extension; apply only through an approved migration release.
BEGIN;
CREATE TABLE social_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('direct')),
  direct_pair_key TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE social_conversation_memberships (
  conversation_id TEXT NOT NULL REFERENCES social_conversations(conversation_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  member_role TEXT NOT NULL CHECK (member_role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  muted_at TIMESTAMPTZ,
  last_read_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE social_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES social_conversations(conversation_id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  client_message_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL,
  edited_at TIMESTAMPTZ,
  recalled_at TIMESTAMPTZ,
  UNIQUE (conversation_id, sequence),
  UNIQUE (sender_user_id, client_message_id)
);
CREATE INDEX ix_social_conversations_updated ON social_conversations(updated_at DESC, conversation_id DESC);
CREATE INDEX ix_social_conversation_memberships_user ON social_conversation_memberships(user_id, left_at, conversation_id);
COMMIT;
