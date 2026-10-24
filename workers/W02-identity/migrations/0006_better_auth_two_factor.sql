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
  FOREIGN KEY (userId) REFERENCES "user"(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX twoFactor_userId_idx ON "twoFactor"(userId);
