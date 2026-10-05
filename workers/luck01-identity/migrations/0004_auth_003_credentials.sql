-- AUTH-003 credential-management persistence migration
-- Admission: CC-MAPPING-0-AUTH-003-MIGRATION-ADMISSION-2026-09-27
-- Owner: W02 / T01 / D1-01
-- Contract: contracts/entity/AUTH-003-identity-field-contract.v1.json
-- Contract: contracts/entity/AUTH-003-credential-field-contract.v1.json
-- Migration: MIG-AUTH-003-CREDENTIAL-V1
--
-- Schema-only by design. No credential backfill is performed because protected
-- value_hash derivation belongs to the application secret/key boundary.

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  username_normalized TEXT UNIQUE,
  email TEXT,
  email_normalized TEXT UNIQUE,
  phone TEXT,
  phone_normalized TEXT UNIQUE,
  normalization_version TEXT NOT NULL
    CHECK (length(normalization_version) > 0)
);

CREATE TABLE auth_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  identity_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('username', 'email', 'phone')),
  value_hash TEXT NOT NULL UNIQUE,
  normalized_value TEXT NOT NULL,
  verified_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (identity_id)
    REFERENCES auth_identities(id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX auth_credentials_kind_normalized_value_uq
  ON auth_credentials (kind, normalized_value);

CREATE INDEX auth_credentials_identity_id_idx
  ON auth_credentials (identity_id);

CREATE INDEX auth_credentials_kind_idx
  ON auth_credentials (kind);

CREATE INDEX auth_credentials_verified_at_idx
  ON auth_credentials (verified_at);

CREATE INDEX auth_credentials_active_idx
  ON auth_credentials (active);

CREATE INDEX auth_credentials_created_at_idx
  ON auth_credentials (created_at);

CREATE INDEX auth_credentials_updated_at_idx
  ON auth_credentials (updated_at);
