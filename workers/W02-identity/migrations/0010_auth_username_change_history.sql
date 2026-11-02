-- W02-authoritative username changes.
-- Keep one compact state row per renamed account. The prior handle is reserved
-- for exactly 30 days; it is not a permanent redirect or an append-only audit log.
-- Public URL redirects are independently managed by the official Payload redirects plugin.

CREATE TABLE auth_username_change_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  username_version INTEGER NOT NULL CHECK (username_version >= 1),
  last_changed_at TEXT NOT NULL,
  previous_username TEXT,
  previous_username_normalized TEXT,
  previous_username_expires_at TEXT,
  idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  idempotency_expires_at TEXT NOT NULL,
  CHECK (
    (previous_username IS NULL AND previous_username_normalized IS NULL AND previous_username_expires_at IS NULL)
    OR
    (previous_username IS NOT NULL AND previous_username_normalized IS NOT NULL AND previous_username_expires_at IS NOT NULL)
  )
);

CREATE INDEX auth_username_change_state_previous_name_idx
  ON auth_username_change_state (previous_username_normalized, previous_username_expires_at);

CREATE INDEX auth_username_change_state_last_changed_idx
  ON auth_username_change_state (last_changed_at);

CREATE INDEX auth_user_username_normalized_lookup_idx
  ON "user" (lower(username));

-- Keep the existing W02 identity normalization projection synchronized inside
-- the same D1 transaction whenever Better Auth's authoritative username changes.
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

-- Enforce the 30-day previous-handle lease even for Better Auth registration
-- or update paths that do not pass through the dedicated W01 username endpoint.
CREATE TRIGGER auth_user_previous_username_reservation_guard_insert
BEFORE INSERT ON "user"
WHEN NEW.username IS NOT NULL
 AND EXISTS (
   SELECT 1
     FROM auth_username_change_state s
    WHERE s.previous_username_normalized = lower(NEW.username)
      AND julianday(s.previous_username_expires_at) > julianday(COALESCE(NEW.updated_at, NEW.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
 )
BEGIN
  SELECT RAISE(ABORT, 'USERNAME_RESERVED');
END;

CREATE TRIGGER auth_user_previous_username_reservation_guard_update
BEFORE UPDATE OF username ON "user"
WHEN NEW.username IS NOT NULL
 AND OLD.username IS NOT NEW.username
 AND EXISTS (
   SELECT 1
     FROM auth_username_change_state s
    WHERE s.previous_username_normalized = lower(NEW.username)
      AND s.previous_username_expires_at > COALESCE(NEW.updated_at, NEW.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
 )
BEGIN
  SELECT RAISE(ABORT, 'USERNAME_RESERVED');
END;
