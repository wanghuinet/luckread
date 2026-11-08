-- GENERATED FILE. Do not hand-edit.
-- Regenerate with scripts/neon/generate-d1-01-creator-postgres-migration.mjs.
-- See scripts/neon/templates/d1-01-creator-postgres.sql for the checked schema template.
-- Source of truth remains migrations/0001_creator_authorization.sql and the D1-01 owner inventory.
-- This file is schema-only; runtime remains on Cloudflare D1 pending a separate cutover gate.

-- GENERATED POSTGRESQL 18 SCHEMA TEMPLATE
-- Canonical source: workers/W08-creator/migrations/0001_creator_authorization.sql
-- Authority: W08 / D1-01 Creator Applications, Creator identity and creator authorization audit.
-- W02 remains the authority for USER identity, account state, RoleAssignment and L0-L8 resolution.
-- user_id, decided_by and audit resource_id values remain opaque references; no cross-domain foreign keys.
-- resource_type='role_assignment' in audit rows is an audit label/reference only, never a copied RoleAssignment.
-- D1-01 membership and W02 identity tables are owned by their separate Workers and are not created here.
-- No account, creator, application or audit business rows are seeded.
-- Runtime remains on Cloudflare D1; this schema is for disposable PostgreSQL CI only.

BEGIN;

CREATE TABLE creator_applications (
  application_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  creator_type TEXT NOT NULL
    CHECK (creator_type IN ('PERSONAL', 'WRITER', 'VIDEO_CREATOR', 'DEVELOPER', 'ARTIST', 'OTHER')),
  statement TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  grant_state TEXT NOT NULL
    CHECK (grant_state IN ('NOT_REQUESTED', 'PENDING', 'GRANTED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version > 0),
  application_idempotency_key TEXT NOT NULL,
  decision_idempotency_key TEXT,
  decided_by TEXT,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  CONSTRAINT creator_applications_user_idempotency_unique
    UNIQUE (user_id, application_idempotency_key)
);

CREATE UNIQUE INDEX creator_applications_one_pending_per_user
  ON creator_applications (user_id)
  WHERE status = 'PENDING';

CREATE INDEX creator_applications_status_created_idx
  ON creator_applications (status, created_at);

CREATE TABLE creators (
  creator_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL UNIQUE,
  creator_type TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING_ROLE_GRANT', 'ACTIVE', 'REVOKED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX creators_status_idx ON creators (status);

CREATE TABLE creator_authorization_audit (
  audit_id TEXT PRIMARY KEY NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'CREATOR_APPLICATION_SUBMITTED',
      'CREATOR_APPLICATION_APPROVED',
      'CREATOR_APPLICATION_REJECTED',
      'CREATOR_ROLE_GRANTED'
    )),
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('creator_application', 'creator', 'role_assignment')),
  resource_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  idempotency_key TEXT,
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX creator_authorization_audit_subject_time_idx
  ON creator_authorization_audit (subject_id, occurred_at);

CREATE INDEX creator_authorization_audit_resource_time_idx
  ON creator_authorization_audit (resource_type, resource_id, occurred_at);

COMMIT;
