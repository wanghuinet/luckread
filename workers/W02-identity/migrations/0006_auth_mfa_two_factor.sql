-- W02 / D1-01 authoritative TOTP-based MFA for privileged sessions.
-- Better Auth 1.7.8 two-factor plugin schema; no existing users are promoted by this migration.

ALTER TABLE "user"
  ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (two_factor_enabled IN (0, 1));

ALTER TABLE "user"
  ADD COLUMN two_factor_enabled_at TEXT;

-- Stamp the exact time MFA becomes active. A privileged session established
-- before this instant cannot continue to satisfy the MFA gate after enrollment.
CREATE TRIGGER user_two_factor_enabled_at_stamp
AFTER UPDATE OF two_factor_enabled ON "user"
WHEN NEW.two_factor_enabled = 1 AND OLD.two_factor_enabled = 0
BEGIN
  UPDATE "user"
  SET two_factor_enabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

-- Better Auth 1.7.8's canonical plugin model/table and camelCase field names.
-- The additional created_at column is used only for audit/provenance and has
-- a DB default because the upstream plugin does not write it.
CREATE TABLE "twoFactor" (
  id TEXT NOT NULL PRIMARY KEY,
  userId TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
  failedVerificationCount INTEGER NOT NULL DEFAULT 0 CHECK (failedVerificationCount >= 0),
  lockedUntil TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (userId) REFERENCES "user"(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX twoFactor_userId_idx ON "twoFactor"(userId);
