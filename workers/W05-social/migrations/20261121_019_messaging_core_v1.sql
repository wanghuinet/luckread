-- W05 / D1-02 source migration: durable 1:1 text messaging core.
-- Neon production artifact is maintained separately under src/neon-postgres-migrations.
CREATE TABLE social_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('direct')),
  direct_pair_key TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE social_conversation_memberships (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_role TEXT NOT NULL CHECK (member_role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  archived_at TEXT,
  muted_at TEXT,
  last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE social_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  client_message_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at TEXT NOT NULL,
  edited_at TEXT,
  recalled_at TEXT,
  UNIQUE (conversation_id, sequence),
  UNIQUE (sender_user_id, client_message_id)
);
CREATE INDEX ix_social_conversations_updated ON social_conversations(updated_at DESC, conversation_id DESC);
CREATE INDEX ix_social_conversation_memberships_user ON social_conversation_memberships(user_id, left_at, conversation_id);
