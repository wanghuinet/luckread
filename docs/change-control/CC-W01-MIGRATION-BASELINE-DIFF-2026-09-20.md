# Change Control — W01 Migration Baseline vs Additive Migration

- ID: CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20
- Date: 2026-09-20
- Scope: W01 Payload migration generation only
- Status: GREEN — EXECUTION ADMITTED

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


## Current source-to-baseline delta audit — 2026-09-20

Compared without executing or authoring SQL:

### Current W01 collection authority
`workers/W01-payload/src/collections/Users.ts` defines six active fields:
- `username` — required, unique, indexed
- `displayName`
- `bio`
- `avatar`
- `locale` — default `en-US`
- `timezone` — default `UTC`

### Existing committed migration baseline
`20250929_111647` creates the Payload `users` table with the native authentication columns and indexes, but does not contain the six approved profile fields above.

Therefore the current source/config and the existing migration baseline are **schema-different**.

The previously generated artifact from run `35459850548` confirms that Payload generation sees the six approved fields, but it also regenerates the full existing schema. That artifact is retained only as diagnostic evidence and is not an accepted additive migration.

### Closure consequence
The logical delta is now known at the contract/config level, but the **safe physical migration** remains unadmitted. A hand-written `ALTER TABLE`, inferred baseline, or remote-state assumption would violate the migration Change Control.

Required next evidence remains the controlled remote D1 migration state for database `luckread`.


## Migration snapshot finding — 2026-09-20

The committed baseline directory currently contains:
- `20250929_111647.ts`
- `index.ts`
- no `20250929_111647.json` migration snapshot.

This is relevant to the observed full-schema regeneration. Payload's migration documentation states that `migrate:create` generates SQL changes from the prior migration state to the current Payload Config. Payload's documented migration model also uses per-migration JSON schema snapshot files; a Payload maintainer/community report specifically notes that when a manual migration lacks its corresponding JSON snapshot, the next `migrate:create` can try to recreate the same schema changes.

Reference:
- https://payloadcms.com/docs/database/migrations
- https://github.com/payloadcms/payload/issues/14941

This finding explains the observed behavior as a strong candidate root cause, but it is **not** promoted as a definitive 3.87.1 adapter-specific diagnosis until reproduced against the exact W01 baseline and Payload 3.87.1.

Safety rule remains unchanged:
- do not hand-author or infer the missing baseline snapshot;
- do not promote the generated full-schema artifact;
- do not execute a remote migration;
- establish the authoritative baseline first, then regenerate under the supported migration workflow.

## Controlled remote baseline evidence — 2026-09-20

- Evidence workflow run: `35484344942`
- Tested commit: `45af6bb9fd91a61c6fd242d71eda3c831fdc9dd0`
- Target: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`
- Environment: `CONTROLLED_REMOTE_D1`
- Remote catalog: only Cloudflare internal `_cf_KV`; `users`, `users_sessions`, `payload_migrations`, and `auth_session_state` are absent.
- D1 metadata: `num_tables=0`, `rows_written_24h=0`.
- Evidence workflow performed read-only queries only; no migration was applied.

### Baseline authority determination
The controlled target is an empty D1 database. The repository contains exactly one executable Payload baseline migration, `workers/W01-payload/src/migrations/20250929_111647.ts`, and no later accepted migration. Its `up` path creates the native Payload baseline tables, including `users`, `users_sessions`, `media`, Payload lock/preference tables, and `payload_migrations`.

Therefore the remote evidence resolves the prior ambiguity about whether the target already contains an incompatible pre-existing schema: it does not. The existing `20250929_111647` artifact is the candidate initial W01 baseline for this empty target.

This does **not** authorize execution. The current W01 source also contains six approved User profile fields that are absent from the baseline migration, so the safe sequence must still prevent a partially migrated application from being promoted and must not treat the previously generated full-schema artifact as an additive second migration.

### Execution admission state
`READY_FOR_EXPLICIT_BASELINE_EXECUTION_ADMISSION`

Required before any remote mutation:
1. Explicitly admit execution of the existing `20250929_111647` baseline only.
2. Execute against `luckread` under controlled environment.
3. Re-capture remote schema and migration history after execution.
4. Generate/reconcile the next additive migration for the six current User profile fields using the supported Payload migration workflow; do not hand-author or infer DDL.
5. Keep the generated full-schema diagnostic artifact unpromoted.

No remote D1 mutation is authorized by this document until the explicit admission state is changed.


## Explicit baseline execution admission — 2026-09-20

Status: GREEN — EXECUTION ADMITTED

Scope is intentionally narrow and fail-closed:

- Target D1: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`
- Environment: `CONTROLLED_REMOTE_D1`
- Approved migration: `workers/W01-payload/src/migrations/20250929_111647.ts` only
- Approved migration index: `workers/W01-payload/src/migrations/index.ts`
- Approved migration blob SHA: `21e4a9ce27c828da655e479e35eb44ea3daff0f3`
- Approved migration index blob SHA: `e596aeb65381fd3bb2e0cfa7879c8f850bb77cbe`

Preconditions established before this admission:

1. Controlled remote D1 evidence shows the target is empty of non-internal application tables.
2. The repository contains exactly one executable Payload baseline migration.
3. The previously generated full-schema migration is not promoted and is outside this execution scope.
4. The migration execution guard must validate this exact migration source/index and reject any additional migration source before remote execution.
5. Post-execution migration-history and schema evidence is mandatory.

This admission authorizes execution of the approved baseline only. It does not authorize the generated full-schema artifact, an additive User-profile migration, `auth_session_state`, or any other migration.

The existing post-execution evidence workflow remains required. No Mapping/Contract status is promoted merely by executing this migration.
