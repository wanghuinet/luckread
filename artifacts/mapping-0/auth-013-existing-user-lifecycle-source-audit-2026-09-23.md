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
