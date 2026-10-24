-- Source authority: Better Auth 1.7.8 twoFactor plugin schema.
-- Applied only through the reviewed W02 D1 migration workflow.
-- The bootstrap grant remains unusable at L5-L8 until TOTP enrollment is verified.

ALTER TABLE "user"
  ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (two_factor_enabled IN (0, 1));

ALTER TABLE "user"
  ADD COLUMN mfa_enrolled_at TEXT;

CREATE TABLE "twoFactor" (
  id TEXT NOT NULL PRIMARY KEY,
  userId TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  failedVerificationCount INTEGER NOT NULL DEFAULT 0 CHECK (failedVerificationCount >= 0),
  lockedUntil TEXT,
  lastAcceptedTotpTimeStep INTEGER CHECK (lastAcceptedTotpTimeStep IS NULL OR lastAcceptedTotpTimeStep >= 0),
  FOREIGN KEY (userId) REFERENCES "user"(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX twoFactor_userId_idx ON "twoFactor"(userId);

-- MFA lifecycle transitions are authoritative at the database boundary. Revoke
-- every pre-existing session on both enable and disable, and clear the
-- enrollment timestamp when MFA is disabled so a later re-enrollment cannot
-- inherit stale assurance from an earlier TOTP factor.
CREATE TRIGGER user_mfa_enable_revoke_sessions
AFTER UPDATE OF two_factor_enabled ON "user"
WHEN OLD.two_factor_enabled = 0 AND NEW.two_factor_enabled = 1
BEGIN
  UPDATE "user"
    SET mfa_enrolled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id;
  DELETE FROM "session" WHERE user_id = NEW.id;
END;

CREATE TRIGGER user_mfa_disable_clear_enrollment
AFTER UPDATE OF two_factor_enabled ON "user"
WHEN OLD.two_factor_enabled = 1 AND NEW.two_factor_enabled = 0
BEGIN
  UPDATE "user" SET mfa_enrolled_at = NULL WHERE id = NEW.id;
  DELETE FROM "session" WHERE user_id = NEW.id;
END;
