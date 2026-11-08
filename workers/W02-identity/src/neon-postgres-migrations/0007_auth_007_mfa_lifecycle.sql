-- GENERATED FILE
-- Source authority: workers/W02-identity/migrations/0006_better_auth_two_factor.sql
-- Field contract: contracts/entity/AUTH-007-mfa-factor-field-contract.v1.json
-- Lifecycle contract: contracts/state-machines/AUTH-007-mfa-lifecycle.v1.json
-- W02 owns MFA factor and lifecycle state; Better Auth 1.7.8 owns the core twoFactor table definition.
-- The official Better Auth schema generator creates "twoFactor", "user".two_factor_enabled and "session".
-- This migration only reconciles the D1-specific constraints, replay-step field and lifecycle triggers.
-- SQLite timestamp TEXT values are represented as PostgreSQL TIMESTAMPTZ.
-- No users, factors, TOTP secrets, recovery codes or sessions are imported.
-- AUTH-007 remains CONTRACTED_NOT_VERIFIED / BLOCKED_NOT_GREEN; no runtime or production migration is authorized.
-- Generator: workers/W02-identity/scripts/neon/generate-auth007-mfa-lifecycle-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical source migration and contracts.

DO $mfa_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "user" WHERE two_factor_enabled IS NULL) THEN
    RAISE EXCEPTION 'AUTH007_MFA_BASELINE_NULL_USER_FLAG_REQUIRES_REVIEW';
  END IF;
  IF EXISTS (SELECT 1 FROM "twoFactor" WHERE "verified" IS NULL OR "failedVerificationCount" IS NULL) THEN
    RAISE EXCEPTION 'AUTH007_MFA_BASELINE_NULL_FACTOR_STATE_REQUIRES_REVIEW';
  END IF;
END;
$mfa_preflight$;

-- The official plugin schema exposes this field as nullable; D1 migration 0006 requires false by default.
ALTER TABLE "user"
  ALTER COLUMN two_factor_enabled SET DEFAULT FALSE,
  ALTER COLUMN two_factor_enabled SET NOT NULL;

ALTER TABLE "user"
  ADD COLUMN mfa_enrolled_at TIMESTAMPTZ,
  ADD COLUMN mfa_enrollment_key_hash TEXT,
  ADD COLUMN mfa_enrollment_confirm_key_hash TEXT,
  ADD COLUMN mfa_enrollment_confirm_request_hash TEXT;

-- Match the D1 lifecycle defaults/constraints while retaining the official Better Auth table.
ALTER TABLE "twoFactor"
  ALTER COLUMN "verified" SET DEFAULT FALSE,
  ALTER COLUMN "verified" SET NOT NULL,
  ALTER COLUMN "failedVerificationCount" SET DEFAULT 0,
  ALTER COLUMN "failedVerificationCount" SET NOT NULL;

ALTER TABLE "twoFactor"
  ADD COLUMN "lastAcceptedTotpTimeStep" INTEGER,
  ADD CONSTRAINT "twoFactor_userId_uq" UNIQUE ("userId"),
  ADD CONSTRAINT "twoFactor_failedVerificationCount_check" CHECK ("failedVerificationCount" >= 0),
  ADD CONSTRAINT "twoFactor_lastAcceptedTotpTimeStep_check"
    CHECK ("lastAcceptedTotpTimeStep" IS NULL OR "lastAcceptedTotpTimeStep" >= 0);

CREATE OR REPLACE FUNCTION w02_user_mfa_enable_revoke_sessions_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "user" SET mfa_enrolled_at = statement_timestamp() WHERE id = NEW.id;
  DELETE FROM "session" WHERE user_id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER user_mfa_enable_revoke_sessions
AFTER UPDATE OF two_factor_enabled ON "user"
FOR EACH ROW
WHEN (OLD.two_factor_enabled IS FALSE AND NEW.two_factor_enabled IS TRUE)
EXECUTE FUNCTION w02_user_mfa_enable_revoke_sessions_fn();

CREATE OR REPLACE FUNCTION w02_user_mfa_disable_clear_enrollment_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "user"
     SET mfa_enrolled_at = NULL,
         mfa_enrollment_key_hash = NULL,
         mfa_enrollment_confirm_key_hash = NULL,
         mfa_enrollment_confirm_request_hash = NULL
   WHERE id = NEW.id;
  DELETE FROM "session" WHERE user_id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER user_mfa_disable_clear_enrollment
AFTER UPDATE OF two_factor_enabled ON "user"
FOR EACH ROW
WHEN (OLD.two_factor_enabled IS TRUE AND NEW.two_factor_enabled IS FALSE)
EXECUTE FUNCTION w02_user_mfa_disable_clear_enrollment_fn();
