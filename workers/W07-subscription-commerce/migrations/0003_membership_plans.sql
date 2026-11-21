-- MembershipPlan storage candidate for the existing D1-01 authority.
-- This migration is source-only until the exact D1-01 target, migration history,
-- and postflight schema are verified through the controlled migration gate.
CREATE TABLE IF NOT EXISTS membership_plans (
  plan_id TEXT NOT NULL PRIMARY KEY CHECK (length(plan_id) BETWEEN 1 AND 256),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('CREATOR', 'COMMUNITY', 'PLATFORM')),
  owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
  current_version INTEGER NOT NULL CHECK (typeof(current_version) = 'integer' AND current_version > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED')),
  visibility TEXT NOT NULL CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_membership_plans_owner_status_updated
  ON membership_plans (owner_type, owner_id, status, updated_at);

CREATE INDEX IF NOT EXISTS ix_membership_plans_status_visibility_updated
  ON membership_plans (status, visibility, updated_at);

CREATE TABLE IF NOT EXISTS membership_plan_versions (
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL CHECK (typeof(plan_version) = 'integer' AND plan_version > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  tier TEXT NOT NULL CHECK (length(tier) BETWEEN 1 AND 64 AND tier GLOB '[a-z]*' AND tier NOT GLOB '*[^a-z0-9_-]*'),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
  price_minor INTEGER NOT NULL CHECK (typeof(price_minor) = 'integer' AND price_minor BETWEEN 0 AND 2147483647),
  currency TEXT NOT NULL CHECK (typeof(currency) = 'text' AND currency GLOB '[A-Z][A-Z][A-Z]'),
  benefits_json TEXT NOT NULL DEFAULT '[]'
    CHECK (length(benefits_json) <= 8192 AND json_valid(benefits_json) AND json_type(benefits_json) = 'array'),
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

CREATE TRIGGER IF NOT EXISTS membership_plans_owner_immutable_update
BEFORE UPDATE OF plan_id, owner_type, owner_id, created_at ON membership_plans
WHEN NEW.plan_id <> OLD.plan_id OR NEW.owner_type <> OLD.owner_type OR NEW.owner_id <> OLD.owner_id OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'membership plan owner and identity are immutable');
END;

CREATE TRIGGER IF NOT EXISTS membership_plans_current_version_forward_only
BEFORE UPDATE OF current_version ON membership_plans
WHEN NEW.current_version <= OLD.current_version
  OR NOT EXISTS (
    SELECT 1 FROM membership_plan_versions
    WHERE plan_id = OLD.plan_id AND plan_version = NEW.current_version
  )
BEGIN
  SELECT RAISE(ABORT, 'membership plan current version must advance to an existing version');
END;
