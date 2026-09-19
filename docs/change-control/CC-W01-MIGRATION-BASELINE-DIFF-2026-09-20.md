# Change Control — W01 Migration Baseline vs Additive Migration

- ID: CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20
- Date: 2026-09-20
- Scope: W01 Payload migration generation only
- Status: OPEN — EXECUTION NOT ADMITTED

## Finding

Payload CLI generation succeeded at run 35459850548 after bootstrapping the existing committed migration in a local-only D1 proxy.

The generated 20260919_180137_MIG_ENT_USER_PROFILE_V1.ts still contains CREATE TABLE statements for existing Payload tables, including users, users_sessions, media, payload_kv, payload_locked_documents, payload_preferences, and payload_migrations. It is therefore not accepted as an additive second migration.

The generated users definition correctly contains the approved ENT-USER fields: username, display_name, bio, avatar, locale and timezone, with username NOT NULL plus a unique index and locale/timezone defaults.

## Decision

Do not commit or execute this generated artifact as a second production migration.

The existing 20250929_111647 migration remains unchanged.

The generated artifact is diagnostic evidence that the current Payload/W01 generation path produces a full schema snapshot under this configuration. It is not migration execution evidence and is not promoted to the W01 migration source.

## Required next closure

1. Establish whether the existing migration is the intended baseline for the controlled deployment target.
2. Obtain controlled D1 migration-state evidence for the target database.
3. Select a migration strategy that cannot duplicate already-existing Payload tables.
4. Generate or regenerate the exact accepted migration using the authoritative strategy.
5. Run migration static audit and, separately, controlled execution evidence.

No remote D1 mutation is authorized by this control.
