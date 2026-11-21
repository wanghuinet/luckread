-- W05-owned PostgreSQL migration: message edit/recall lifecycle.
-- Recalled messages remain as non-content tombstones so clients can render a stable
-- conversation timeline while private attachment authorization is revoked.
BEGIN;

ALTER TABLE social_messages
  DROP CONSTRAINT IF EXISTS social_messages_body_or_attachments_check;

ALTER TABLE social_messages
  ADD CONSTRAINT social_messages_body_or_attachments_check
  CHECK (
    char_length(body) BETWEEN 0 AND 10000
    AND CASE
      WHEN jsonb_typeof(attachments) = 'array' THEN jsonb_array_length(attachments) <= 4
      ELSE FALSE
    END
    AND (
      char_length(body) > 0
      OR jsonb_array_length(attachments) > 0
      OR recalled_at IS NOT NULL
    )
  );

COMMENT ON COLUMN social_messages.edited_at IS
  'Timestamp of the most recent sender edit; null until the message is edited.';
COMMENT ON COLUMN social_messages.recalled_at IS
  'Recall tombstone timestamp; recalled body and attachment references are cleared and private media reads are denied.';

COMMIT;
