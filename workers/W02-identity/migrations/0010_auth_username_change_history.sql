-- W02-authoritative username changes.
-- Current username remains in Better Auth's "user" row. This table permanently
-- reserves old handles, retains secret-free idempotency outcomes, and provides
-- an auditable version/time source for optimistic concurrency and 30-day cooldown.
-- user_id deliberately has no FK: historic handles remain reserved after account deletion.

CREATE TABLE auth_username_change_history (
  change_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  old_username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  new_username TEXT NOT NULL,
  new_username_normalized TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  session_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128),
  changed_at TEXT NOT NULL,
  UNIQUE (user_id, version),
  UNIQUE (user_id, idempotency_key_hash)
);

CREATE INDEX auth_username_change_history_user_version_idx
  ON auth_username_change_history (user_id, version DESC);

CREATE INDEX auth_username_change_history_changed_at_idx
  ON auth_username_change_history (changed_at);

-- Keep the existing W02 identity normalization projection synchronized inside
-- the same D1 transaction whenever Better Auth's authoritative username changes.
-- Accepted usernames are ASCII alphanumeric; lower() is therefore identical to
-- the contracted trim -> NFC -> casefold canonical key after input validation.
CREATE TRIGGER auth_username_identity_projection_sync
AFTER UPDATE OF username ON "user"
WHEN OLD.username IS NOT NEW.username
BEGIN
  UPDATE auth_identities
     SET username = NEW.username,
         username_normalized = lower(NEW.username),
         normalization_version = 'unicode-nfc-casefold-v1'
   WHERE user_id = NEW.id;
END;
