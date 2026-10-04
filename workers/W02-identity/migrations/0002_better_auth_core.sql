-- BETTER AUTH CORE V1
-- Owner: W02 / D1-01
-- Change Control: CC-BETTER-AUTH-W02-AUTHORITY-2026-10-05

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_uq ON auth_sessions(token);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  id_token TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_provider_account_uq ON auth_accounts(provider_id, account_id);
CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx ON auth_accounts(user_id);
CREATE INDEX IF NOT EXISTS auth_accounts_provider_id_idx ON auth_accounts(provider_id);

CREATE TABLE IF NOT EXISTS auth_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE INDEX IF NOT EXISTS auth_verifications_expires_at_idx ON auth_verifications(expires_at);

INSERT INTO auth_accounts (id,user_id,account_id,provider_id,password,created_at,updated_at)
SELECT
  lower(hex(randomblob(16))),
  CAST(u.id AS TEXT),
  CAST(u.id AS TEXT),
  'credential',
  CASE
    WHEN u.hash LIKE 'pbkdf2-sha256-v1:%' AND u.salt IS NOT NULL
      THEN 'pbkdf2-sha256-v1:' || u.salt || ':' || substr(u.hash,length('pbkdf2-sha256-v1:')+1)
    WHEN u.hash IS NOT NULL AND u.salt IS NOT NULL
      THEN 'pbkdf2-sha256-legacy:' || u.salt || ':' || u.hash
    ELSE NULL
  END,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.hash IS NOT NULL AND u.salt IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM auth_accounts a
  WHERE a.provider_id='credential' AND a.account_id=CAST(u.id AS TEXT)
);
