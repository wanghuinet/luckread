import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const migrationPath = resolve(workerRoot, 'migrations/0006_better_auth_two_factor.sql')
const authSourcePath = resolve(workerRoot, 'src/auth/better-auth.ts')
const factorContractPath = resolve(repositoryRoot, 'contracts/entity/AUTH-007-mfa-factor-field-contract.v1.json')
const lifecycleContractPath = resolve(repositoryRoot, 'contracts/state-machines/AUTH-007-mfa-lifecycle.v1.json')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0007_auth_007_mfa_lifecycle.sql')

const migration = readFileSync(migrationPath, 'utf8')
const authSource = readFileSync(authSourcePath, 'utf8')
const factorContract = JSON.parse(readFileSync(factorContractPath, 'utf8'))
const lifecycleContract = JSON.parse(readFileSync(lifecycleContractPath, 'utf8'))
const fail = (message) => { throw new Error('AUTH-007 MFA lifecycle PostgreSQL schema contract drift: ' + message) }

if (factorContract.status !== 'CONTRACTED_NOT_VERIFIED' ||
    lifecycleContract.status !== 'CONTRACTED_NOT_VERIFIED') {
  fail('AUTH-007 must remain CONTRACTED_NOT_VERIFIED; this schema slice does not admit GREEN')
}
if (
  factorContract.persistenceAuthority?.worker !== 'W02' ||
  factorContract.persistenceAuthority?.database !== 'D1-01' ||
  factorContract.persistenceAuthority?.writer !== 'W02 only' ||
  factorContract.persistenceAuthority?.table !== 'twoFactor' ||
  factorContract.persistenceAuthority?.userExtensionTable !== 'user'
) fail('W02 / D1-01 persistence authority')
if (
  lifecycleContract['x-luckread']?.authoritativeWorker !== 'W02-identity' ||
  lifecycleContract['x-luckread']?.persistenceAuthority !== 'D1-01' ||
  lifecycleContract['x-luckread']?.directFrontendDatabaseAccess !== false
) fail('MFA lifecycle authority boundary')
if (!/import\s*\{\s*bearer,\s*twoFactor\s*\}\s*from\s*['"]better-auth\/plugins['"]/.test(authSource) ||
    !/twoFactor\s*\(/.test(authSource)) {
  fail('Better Auth 1.7.8 twoFactor plugin must remain in the official generated core schema')
}

const userFields = factorContract.userExtensionFields ?? []
const expectedUserFields = [
  { name: 'twoFactorEnabled', columnName: 'two_factor_enabled', type: 'boolean', nullable: false, required: true, defaultValue: false },
  { name: 'mfaEnrolledAt', columnName: 'mfa_enrolled_at', type: 'datetime', nullable: true, required: false },
  { name: 'mfaEnrollmentKeyHash', columnName: 'mfa_enrollment_key_hash', type: 'text', nullable: true, required: false },
  { name: 'mfaEnrollmentConfirmKeyHash', columnName: 'mfa_enrollment_confirm_key_hash', type: 'text', nullable: true, required: false },
  { name: 'mfaEnrollmentConfirmRequestHash', columnName: 'mfa_enrollment_confirm_request_hash', type: 'text', nullable: true, required: false },
]
if (userFields.length !== expectedUserFields.length) fail('exactly five canonical user extension fields are expected')
for (const expected of expectedUserFields) {
  const field = userFields.find((candidate) => candidate.name === expected.name)
  if (!field) fail('missing user field ' + expected.name)
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(field[key]) !== JSON.stringify(value)) {
      fail('user field contract ' + expected.name + '.' + key)
    }
  }
}
const lastStep = (factorContract.factorFields ?? []).find((field) => field.name === 'lastAcceptedTotpTimeStep')
if (
  lastStep?.columnName !== 'lastAcceptedTotpTimeStep' ||
  lastStep?.type !== 'integer' ||
  lastStep?.nullable !== true ||
  lastStep?.required !== false ||
  !lastStep?.requiredInvariant?.includes('same TOTP time-step must not be accepted more than once')
) fail('durable TOTP replay-step field contract')

const expectedSourceTokens = [
  'ALTER TABLE "user"',
  'ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0',
  'ADD COLUMN mfa_enrolled_at TEXT',
  'ADD COLUMN mfa_enrollment_key_hash TEXT',
  'ADD COLUMN mfa_enrollment_confirm_key_hash TEXT',
  'ADD COLUMN mfa_enrollment_confirm_request_hash TEXT',
  'CREATE TABLE "twoFactor"',
  'userId TEXT NOT NULL UNIQUE',
  'verified INTEGER NOT NULL DEFAULT 0',
  'failedVerificationCount INTEGER NOT NULL DEFAULT 0',
  'lastAcceptedTotpTimeStep INTEGER CHECK',
  'CREATE TRIGGER user_mfa_enable_revoke_sessions',
  'CREATE TRIGGER user_mfa_disable_clear_enrollment',
  'DELETE FROM "session" WHERE user_id = NEW.id',
]
for (const token of expectedSourceTokens) {
  if (!migration.includes(token)) fail('source D1 migration missing ' + token)
}
for (const invariant of [
  'pre-existing sessions are revoked on enable and disable',
  'Every accepted TOTP time-step is atomically consumed once per factor.',
  'Only W02 derives factor state from authoritative D1-01 records.',
]) {
  const all = JSON.stringify(lifecycleContract)
  if (!all.includes(invariant)) fail('lifecycle security invariant missing: ' + invariant)
}
if (
  factorContract.evidenceStatus?.auth007 !== 'BLOCKED_NOT_GREEN' ||
  lifecycleContract.status !== 'CONTRACTED_NOT_VERIFIED'
) fail('must preserve AUTH-007 formal evidence status')

const sql = [
  '-- GENERATED FILE',
  '-- Source authority: workers/W02-identity/migrations/0006_better_auth_two_factor.sql',
  '-- Field contract: contracts/entity/AUTH-007-mfa-factor-field-contract.v1.json',
  '-- Lifecycle contract: contracts/state-machines/AUTH-007-mfa-lifecycle.v1.json',
  '-- W02 owns MFA factor and lifecycle state; Better Auth 1.7.8 owns the core twoFactor table definition.',
  '-- The official Better Auth schema generator creates "twoFactor", "user".two_factor_enabled and "session".',
  '-- This migration only reconciles the D1-specific constraints, replay-step field and lifecycle triggers.',
  '-- SQLite timestamp TEXT values are represented as PostgreSQL TIMESTAMPTZ.',
  '-- No users, factors, TOTP secrets, recovery codes or sessions are imported.',
  '-- AUTH-007 remains CONTRACTED_NOT_VERIFIED / BLOCKED_NOT_GREEN; no runtime or production migration is authorized.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth007-mfa-lifecycle-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical source migration and contracts.',
  '',
  'DO $mfa_preflight$',
  'BEGIN',
  '  IF EXISTS (SELECT 1 FROM "user" WHERE two_factor_enabled IS NULL) THEN',
  "    RAISE EXCEPTION 'AUTH007_MFA_BASELINE_NULL_USER_FLAG_REQUIRES_REVIEW';",
  '  END IF;',
  '  IF EXISTS (SELECT 1 FROM "twoFactor" WHERE "verified" IS NULL OR "failedVerificationCount" IS NULL) THEN',
  "    RAISE EXCEPTION 'AUTH007_MFA_BASELINE_NULL_FACTOR_STATE_REQUIRES_REVIEW';",
  '  END IF;',
  'END;',
  '$mfa_preflight$;',
  '',
  '-- The official plugin schema exposes this field as nullable; D1 migration 0006 requires false by default.',
  'ALTER TABLE "user"',
  '  ALTER COLUMN two_factor_enabled SET DEFAULT FALSE,',
  '  ALTER COLUMN two_factor_enabled SET NOT NULL;',
  '',
  'ALTER TABLE "user"',
  '  ADD COLUMN mfa_enrolled_at TIMESTAMPTZ,',
  '  ADD COLUMN mfa_enrollment_key_hash TEXT,',
  '  ADD COLUMN mfa_enrollment_confirm_key_hash TEXT,',
  '  ADD COLUMN mfa_enrollment_confirm_request_hash TEXT;',
  '',
  '-- Match the D1 lifecycle defaults/constraints while retaining the official Better Auth table.',
  'ALTER TABLE "twoFactor"',
  '  ALTER COLUMN "verified" SET DEFAULT FALSE,',
  '  ALTER COLUMN "verified" SET NOT NULL,',
  '  ALTER COLUMN "failedVerificationCount" SET DEFAULT 0,',
  '  ALTER COLUMN "failedVerificationCount" SET NOT NULL;',
  '',
  'ALTER TABLE "twoFactor"',
  '  ADD COLUMN "lastAcceptedTotpTimeStep" INTEGER,',
  '  ADD CONSTRAINT "twoFactor_userId_uq" UNIQUE ("userId"),',
  '  ADD CONSTRAINT "twoFactor_failedVerificationCount_check" CHECK ("failedVerificationCount" >= 0),',
  '  ADD CONSTRAINT "twoFactor_lastAcceptedTotpTimeStep_check"',
  '    CHECK ("lastAcceptedTotpTimeStep" IS NULL OR "lastAcceptedTotpTimeStep" >= 0);',
  '',
  '-- Enable is an edge-triggered transition. The internal metadata UPDATE does not update two_factor_enabled.',
  '-- Enable is an edge-triggered transition. The internal metadata UPDATE does not update two_factor_enabled.',
  'CREATE OR REPLACE FUNCTION w02_user_mfa_enable_revoke_sessions_fn()',
  'RETURNS trigger',
  'LANGUAGE plpgsql',
  'AS $function$',
  'BEGIN',
  '  UPDATE "user" SET mfa_enrolled_at = statement_timestamp() WHERE id = NEW.id;',
  '  DELETE FROM "session" WHERE user_id = NEW.id;',
  '  RETURN NEW;',
  'END;',
  '$function$;',
  '',
  'CREATE TRIGGER user_mfa_enable_revoke_sessions',
  'AFTER UPDATE OF two_factor_enabled ON "user"',
  'FOR EACH ROW',
  'WHEN (OLD.two_factor_enabled IS FALSE AND NEW.two_factor_enabled IS TRUE)',
  'EXECUTE FUNCTION w02_user_mfa_enable_revoke_sessions_fn();',
  '',
  '-- Disable clears all W02 enrollment/idempotency metadata and invalidates every existing session.',
  '-- Disable clears all W02 enrollment/idempotency metadata and invalidates every existing session.',
  'CREATE OR REPLACE FUNCTION w02_user_mfa_disable_clear_enrollment_fn()',
  'RETURNS trigger',
  'LANGUAGE plpgsql',
  'AS $function$',
  'BEGIN',
  '  UPDATE "user"',
  '     SET mfa_enrolled_at = NULL,',
  '         mfa_enrollment_key_hash = NULL,',
  '         mfa_enrollment_confirm_key_hash = NULL,',
  '         mfa_enrollment_confirm_request_hash = NULL',
  '   WHERE id = NEW.id;',
  '  DELETE FROM "session" WHERE user_id = NEW.id;',
  '  RETURN NEW;',
  'END;',
  '$function$;',
  '',
  'CREATE TRIGGER user_mfa_disable_clear_enrollment',
  'AFTER UPDATE OF two_factor_enabled ON "user"',
  'FOR EACH ROW',
  'WHEN (OLD.two_factor_enabled IS TRUE AND NEW.two_factor_enabled IS FALSE)',
  'EXECUTE FUNCTION w02_user_mfa_disable_clear_enrollment_fn();',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH007_MFA_LIFECYCLE_POSTGRES_MIGRATION_GENERATION_PASS')
