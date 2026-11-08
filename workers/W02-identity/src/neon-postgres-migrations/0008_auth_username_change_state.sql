-- GENERATED FILE
-- Source authority: workers/W02-identity/migrations/0010_auth_username_change_state.sql
-- Owner policy: docs/change-control/CC-W02-USERNAME-CHANGE-AUTHORITY-2026-11-02.md
-- Reserved-name policy: contracts/security/username-reservation-policy.v1.json
-- W02 owns the current username and one compact prior-handle reservation state per renamed account.
-- This does not create permanent aliases, public redirects, or Payload redirect documents.
-- Official Better Auth "user" and existing W02 auth_identities remain the authorities.
-- SQLite canonical UTC ISO timestamp TEXT fields are represented as PostgreSQL TIMESTAMPTZ.
-- The existing 30-day lease is enforced on Better Auth insert/update entry points by W02 triggers.
-- No user rows, prior handles, redirects or idempotency receipts are imported.
-- No production D1 migration/deployment, W01 public API activation, or runtime cutover is included.
-- Generator: workers/W02-identity/scripts/neon/generate-username-change-state-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the source migration and owner policy.

DO $username_preflight$
BEGIN
  IF EXISTS (
    SELECT username FROM "user"
     WHERE username IS NOT NULL
     GROUP BY username HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'W02_USERNAME_BASELINE_DUPLICATE_USERNAME_REQUIRES_REVIEW';
  END IF;
END;
$username_preflight$;

-- The Better Auth generator exposes username but does not make it UNIQUE in PostgreSQL.
-- D1 core migration 0005 declares username UNIQUE; preserve that base invariant.
ALTER TABLE "user"
  ADD CONSTRAINT user_username_uq UNIQUE (username);

CREATE TABLE auth_username_change_state (
  user_id TEXT NOT NULL CONSTRAINT auth_username_change_state_pkey PRIMARY KEY,
  username_version INTEGER NOT NULL CHECK (username_version >= 1),
  last_changed_at TIMESTAMPTZ NOT NULL,
  previous_username TEXT,
  previous_username_normalized TEXT,
  previous_username_expires_at TIMESTAMPTZ,
  idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  idempotency_expires_at TIMESTAMPTZ NOT NULL,
  changed_username TEXT NOT NULL,
  CONSTRAINT auth_username_change_state_previous_name_group_check CHECK (
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

CREATE OR REPLACE FUNCTION w02_auth_username_identity_projection_sync_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE auth_identities
     SET username = NEW.username,
         username_normalized = lower(NEW.username),
         normalization_version = 'unicode-nfc-casefold-v1'
   WHERE user_id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER auth_username_identity_projection_sync
AFTER UPDATE OF username ON "user"
FOR EACH ROW
WHEN (OLD.username IS DISTINCT FROM NEW.username)
EXECUTE FUNCTION w02_auth_username_identity_projection_sync_fn();

CREATE OR REPLACE FUNCTION w02_auth_user_previous_username_reservation_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.username IS NOT NULL AND EXISTS (
    SELECT 1
      FROM auth_username_change_state s
     WHERE s.previous_username_normalized = lower(NEW.username)
       AND s.previous_username_expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'USERNAME_RESERVED';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER auth_user_previous_username_reservation_guard_insert
BEFORE INSERT ON "user"
FOR EACH ROW
WHEN (NEW.username IS NOT NULL)
EXECUTE FUNCTION w02_auth_user_previous_username_reservation_guard_fn();

CREATE TRIGGER auth_user_previous_username_reservation_guard_update
BEFORE UPDATE OF username ON "user"
FOR EACH ROW
WHEN (NEW.username IS NOT NULL AND OLD.username IS DISTINCT FROM NEW.username)
EXECUTE FUNCTION w02_auth_user_previous_username_reservation_guard_fn();
