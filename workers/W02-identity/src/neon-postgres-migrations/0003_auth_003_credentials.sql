-- GENERATED FILE
-- Source authority: contracts/entity/AUTH-003-identity-field-contract.v1.json
-- Source authority: contracts/entity/AUTH-003-credential-field-contract.v1.json
-- Uniqueness authority: contracts/api/AUTH-003-credential-management-contract.v1.json
-- Target: W02 PostgreSQL schema baseline only; production W02 remains on D1-01.
-- No identities or credentials are backfilled; HMAC value_hash derivation stays in the W02 secret boundary.
-- Generator: workers/W02-identity/scripts/neon/generate-auth003-credentials-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical contracts.

CREATE TABLE auth_identities (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL CONSTRAINT auth_identities_user_id_uq UNIQUE,
  username TEXT,
  username_normalized TEXT CONSTRAINT auth_identities_username_normalized_uq UNIQUE,
  email TEXT,
  email_normalized TEXT CONSTRAINT auth_identities_email_normalized_uq UNIQUE,
  phone TEXT,
  phone_normalized TEXT CONSTRAINT auth_identities_phone_normalized_uq UNIQUE,
  normalization_version TEXT NOT NULL CHECK (length(normalization_version) > 0)
);

CREATE TABLE auth_credentials (
  id TEXT NOT NULL PRIMARY KEY,
  identity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('username', 'email', 'phone')),
  value_hash TEXT NOT NULL CONSTRAINT auth_credentials_value_hash_uq UNIQUE,
  normalized_value TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_credentials_identity_fk
    FOREIGN KEY (identity_id) REFERENCES auth_identities(id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT auth_credentials_kind_normalized_value_uq UNIQUE (kind, normalized_value)
);

-- The composite unique constraint supplies the leading kind lookup index.
-- Do not add normalized_value as a separate UNIQUE key: the contract only
-- forbids duplicates within the same kind.
CREATE INDEX auth_credentials_identity_id_idx ON auth_credentials(identity_id);
CREATE INDEX auth_credentials_verified_at_idx ON auth_credentials(verified_at);
CREATE INDEX auth_credentials_active_idx ON auth_credentials(active);
CREATE INDEX auth_credentials_created_at_idx ON auth_credentials(created_at);
CREATE INDEX auth_credentials_updated_at_idx ON auth_credentials(updated_at);
