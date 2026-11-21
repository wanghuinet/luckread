-- W05-owned PostgreSQL migration: direct-message attachment metadata.
-- Binary objects remain owned by W01 Payload Media + Cloudflare R2.
-- This migration stores only validated media references; it does not copy files.
BEGIN;

ALTER TABLE social_messages
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE social_messages
  DROP CONSTRAINT IF EXISTS social_messages_body_check;

ALTER TABLE social_messages
  ADD CONSTRAINT social_messages_body_or_attachments_check
  CHECK (
    char_length(body) BETWEEN 0 AND 10000
    AND CASE
      WHEN jsonb_typeof(attachments) = 'array' THEN jsonb_array_length(attachments) <= 4
      ELSE FALSE
    END
    AND (char_length(body) > 0 OR jsonb_array_length(attachments) > 0)
  );

CREATE INDEX ix_social_messages_attachments_gin
  ON social_messages USING GIN (attachments jsonb_path_ops);

COMMENT ON COLUMN social_messages.attachments IS
  'W01-validated Payload Media references for this message; metadata only, never binary data or delivery URLs.';

COMMIT;
