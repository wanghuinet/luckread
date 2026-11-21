# Change Control — W01 ENT-USER Profile Migration Execution — 2026-09-25

- ID: CC-W01-ENT-USER-PROFILE-MIGRATION-2026-09-25
- Date: 2026-09-25
- Status: GREEN — EXECUTION ADMITTED
- Scope: Execute only the generated additive migration that realizes the already-authorized six canonical ENT-USER fields in W01 Payload users.

## Authority basis

- `CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18` already selected the six canonical fields as the authoritative W01 target: `username`, `displayName`, `bio`, `avatar`, `locale`, `timezone`.
- Current `workers/W01-payload/src/collections/Users.ts` implements those six fields.
- AUTH-002 remote runtime evidence Run `36127160884` against main `80e33466c1ca5130677c09a7953f80fb0c238c1f` reached the real W01 Worker but failed at `POST /api/users` with HTTP 500 before native session creation; the evidence package shows the remote migration history still contains only `20250929_111647` and `20260921_003203_MIG_AUTH_002_SESSION_V1`.
- Generation Probe Run `36128304194` succeeded and generated the exact Payload CLI delta migration for the six approved fields.

## Admitted source

- Migration: `workers/W01-payload/src/migrations/20260925_111503_MIG_ENT_USER_PROFILE_V1.ts`
- Migration blob: `3f469bea4d1bc74b81815848f71334b507358b7a`
- Migration index blob after registration: `fab4442a1840899c10e25af2ddb9a7f0f004aa7a`
- Generation command: `pnpm exec payload migrate:create MIG-ENT-USER-PROFILE-V1 --skip-empty`
- Generation evidence: Run `36128304194`.

## Execution boundary

Execution is authorized only through:
`.github/workflows/w01-ent-user-profile-migration-execution.yml`

Required manual inputs:
- `source_sha`: exact merged main commit containing this admitted migration and execution workflow.
- `database_name`: `luckread`.
- `confirm`: `APPLY_ENT_USER_PROFILE_MIGRATION`.

The workflow must fail closed before any D1 mutation unless all of the following are true:
- the checked-out source SHA is exact;
- the admitted migration and index blobs are exact;
- executable migration sources are exactly the baseline migration, the AUTH-002 session migration, and this profile migration;
- remote `users` row count is exactly `0`;
- none of the six target columns exists yet;
- remote migration history is exactly the two already-admitted migrations.

## Post-execution acceptance

Promotion of the migration execution evidence requires:
- the profile migration appears exactly once in `payload_migrations`;
- `users` contains all six target columns;
- `users_username_idx` exists;
- execution provenance is bound to the exact source SHA and controlled D1 target;
- the workflow artifact is retained as remote evidence.

## Non-actions

- No Contract or Blueprint semantics are changed.
- No D1-01/D1-02 topology changes.
- No second User entity, session table, or auth authority.
- No hand-authored DDL is introduced; the migration is the exact Payload CLI-generated delta.
- AUTH-002 runtime evidence is not re-promoted from source code or generation success.
