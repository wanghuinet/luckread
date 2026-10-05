-- 1.1 W02 native Better Auth identity store
-- Authority: W02 / Better Auth / D1-01
-- Payload tables remain content/CMS projection infrastructure only.
-- No existing production users are migrated by this migration.

CREATE TABLE "user" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  image TEXT,
  username TEXT UNIQUE,
  bio TEXT,
  locale TEXT NOT NULL DEFAULT 'en-US',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  account_state TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (
      account_state IN (
        'UNREGISTERED',
        'PENDING_VERIFICATION',
        'ACTIVE',
        'RESTRICTED',
        'FROZEN',
        'SUSPENDED',
        'BANNED',
        'DELETION_REQUESTED',
        'DELETION_PENDING',
        'DELETED',
        'RESTORED',
        'REACTIVATED'
      )
    ),
  account_state_version INTEGER NOT NULL DEFAULT 1
    CHECK (account_state_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX user_account_state_idx ON "user" (account_state);
CREATE INDEX user_account_state_version_idx ON "user" (account_state_version);

CREATE TABLE "session" (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX session_user_id_idx ON "session" (user_id);
CREATE INDEX session_expires_at_idx ON "session" (expires_at);

CREATE TABLE "account" (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_id, account_id),
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX account_user_id_idx ON "account" (user_id);
CREATE INDEX account_provider_id_idx ON "account" (provider_id);

CREATE TABLE "verification" (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX verification_identifier_idx ON "verification" (identifier);
CREATE INDEX verification_expires_at_idx ON "verification" (expires_at);
