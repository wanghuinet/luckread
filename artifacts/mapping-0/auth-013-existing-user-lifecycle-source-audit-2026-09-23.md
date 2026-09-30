# AUTH-013 Existing-User Lifecycle Source Audit — 2026-09-23

## Result

**NO_AUTHORITY_SOURCE_ESTABLISHED**

This audit supports the selected Decision C. It does not inspect or export individual user records and performs no remote D1 mutation.

## Evidence checked

### 1. Active User implementation

Current authoritative W01 collection source:

`workers/W01-payload/src/collections/Users.ts`

The collection declares:
- `username`
- `displayName`
- `bio`
- `avatar`
- `locale`
- `timezone`

It does not declare `account_state` or `account_state_version`.

### 2. Controlled D1 schema evidence

Historical controlled read-only evidence:

- Workflow run: `35657959095`
- Tested commit: `48575b4a2b86bf317e4e4ccac6c6ec17739cf2eb`
- Environment: `CONTROLLED_REMOTE_D1`
- Database: `luckread`

Observed `users` columns:

`id`, `updated_at`, `created_at`, `email`, `reset_password_token`, `reset_password_expiration`, `salt`, `hash`, `login_attempts`, `lock_until`.

The captured schema did not contain `account_state` or `account_state_version`.

### 3. Authority separation

Existing authority material does not permit treating any of the following as a substitute for an authoritative lifecycle state:

- verification status;
- Payload role/profile state;
- entitlement;
- subscription;
- session state;
- login-attempt lock state;
- cache state.

### 4. Repository search outcome

No current repository artifact was found that provides all of the following simultaneously for pre-existing User rows:

- authoritative lifecycle classification;
- complete row coverage;
- deterministic mapping to Account State Machine values;
- explicit initial `account_state_version` semantics;
- auditable provenance.

Therefore no source qualifies for migration-time backfill authorization.

## Decision

Decision C remains selected:

**Do not perform account-state backfill until an authoritative source/policy is explicitly admitted.**

## Next evidence target

The next investigation may inspect aggregate, privacy-safe metadata only. It must not export unnecessary User PII. Once a complete source is demonstrated, a separate Change Control admission can define the backfill values and release the migration gate.

No remote mutation is authorized by this audit.

## Current controlled-target evidence — 2026-09-23

A fresh read-only GitHub Actions evidence run was completed against the current controlled D1-01 target:

- Workflow run: `35852723250` — **SUCCESS**
- Tested commit: `29c2e77e8393bec6f9f21183d40e3f2b1b07c28f`
- Environment: `CONTROLLED_REMOTE_D1`
- Database: `luckread`
- Database UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`
- Evidence artifact: `10746087117`
- Artifact digest: `sha256:9ea5048d252d0006665925387cfabed0116f4a0bc8841b884bc9ecff72a2d001`

Observed target state:

- `users` row count: **0**
- `users` schema still has no `account_state` or `account_state_version`
- migration history contains `20250929_111647` and `20260921_003203_MIG_AUTH_002_SESSION_V1`
- the evidence SQL reported zero writes / no changed database

### Updated disposition

The current controlled target contains **no pre-existing User rows requiring lifecycle classification**. Therefore the row-coverage question is now deterministically satisfied for the captured target as **0/0 rows**.

This does **not** authorize a migration or choose an initial `account_state_version`. The remaining semantic gate is the authoritative initialization rule for newly persisted User lifecycle version state, which must be explicitly admitted before final non-null persistence is implemented.

