-- W02 / D1-01 MFA persistence using the Better Auth 1.7.8 two-factor schema.
-- No existing users are enrolled or promoted by this migration.

ALTER TABLE "user"
  ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (two_factor_enabled IN (0, 1));

ALTER TABLE "user"
  ADD COLUMN two_factor_enabled_at TEXT;

-- Stamp the exact time MFA becomes active so a session created before enrollment
-- cannot continue to satisfy the L5-L8 MFA gate.
CREATE TRIGGER user_two_factor_enabled_at_stamp
AFTER UPDATE OF two_factor_enabled ON "user"
WHEN NEW.two_factor_enabled = 1 AND OLD.two_factor_enabled = 0
BEGIN
  UPDATE "user"
  SET two_factor_enabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

-- Better Auth's plugin model/table name and camelCase fields are intentional.
-- userId uniqueness enforces one active TOTP factor row per identity.
CREATE TABLE "twoFactor" (
  id TEXT NOT NULL PRIMARY KEY,
  userId TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
  failedVerificationCount INTEGER NOT NULL DEFAULT 0 CHECK (failedVerificationCount >= 0),
  lockedUntil TEXT,
  FOREIGN KEY (userId) REFERENCES "user"(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX twoFactor_secret_idx ON "twoFactor"(secret);
