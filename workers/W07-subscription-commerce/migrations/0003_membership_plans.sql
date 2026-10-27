-- MembershipPlan storage candidate for the existing D1-01 authority.
-- This migration is source-only until the exact D1-01 target, migration history,
-- and postflight schema are verified through the controlled migration gate.
CREATE TABLE IF NOT EXISTS membership_plans (
  plan_id TEXT NOT NULL PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('CREATOR', 'COMMUNITY', 'PLATFORM')),
  owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED')),
  visibility TEXT NOT NULL CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_membership_plans_owner_status_updated
  ON membership_plans (owner_type, owner_id, status, updated_at);

CREATE INDEX IF NOT EXISTS ix_membership_plans_status_visibility_updated
  ON membership_plans (status, visibility, updated_at);

CREATE TABLE IF NOT EXISTS membership_plan_versions (
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  tier TEXT NOT NULL CHECK (length(tier) BETWEEN 1 AND 64),
  billing_interval TEXT NOT NULL CHECK (length(billing_interval) BETWEEN 1 AND 32),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  benefits_json TEXT NOT NULL DEFAULT '[]'
    CHECK (length(benefits_json) <= 8192 AND json_valid(benefits_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, plan_version),
  FOREIGN KEY (plan_id) REFERENCES membership_plans(plan_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_membership_plan_versions_created
  ON membership_plan_versions (plan_id, created_at);

-- Plan versions are immutable so subscriptions and orders can continue to
-- reference the exact commercial definition that was accepted.
CREATE TRIGGER IF NOT EXISTS membership_plan_versions_immutable_update
BEFORE UPDATE ON membership_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'membership plan versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS membership_plan_versions_immutable_delete
BEFORE DELETE ON membership_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'membership plan versions are retained');
END;
