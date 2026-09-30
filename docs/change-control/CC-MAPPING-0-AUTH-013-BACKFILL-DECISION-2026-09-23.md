# AUTH-013 Existing-User Backfill Decision — 2026-09-23

- Change Control: `CC-MAPPING-0-AUTH-013-BACKFILL-DECISION-2026-09-23`
- Feature: `AUTH-013`
- Decision: **C — defer backfill until an authoritative source/policy is explicitly established**
- Decision status: `APPROVED_DECISION / MIGRATION_BLOCKED`
- Worker authority: W02
- Persistence authority: D1-01 / `users`

## Decision

Do **not** assign a uniform initial `account_state` or `account_state_version` to existing User rows yet.

Do **not** derive those values from verification status, Payload role/profile fields, entitlement, subscription, session state, login lock fields, or cache state.

The migration remains blocked until an authoritative, complete, deterministic source/policy for pre-existing User rows is explicitly admitted.

## Evidence supporting the decision

1. The active W01 Payload `Users.ts` contains only six application profile fields:
   `username`, `displayName`, `bio`, `avatar`, `locale`, `timezone`.
   It does not contain lifecycle state or lifecycle version fields.

2. Controlled remote D1 evidence from workflow run `35657959095` shows the existing `users` table contains Payload-native authentication columns such as `login_attempts` and `lock_until`, but no `account_state` or `account_state_version` columns.

3. Existing AUTHZ authority material explicitly states that verification status, account state, entitlement or subscription alone must not be substituted for the authoritative authorization model.

4. The authoritative Account State Machine defines the registration initial state and lifecycle transitions, but does not define a migration-time rule for converting already-persisted User rows into an initial lifecycle state/version.

## Why A is rejected for now

A blanket state assignment would create a new authoritative fact for every existing account without evidence that the same lifecycle state accurately describes every row.

## Why B is rejected for now

A derived per-row mapping requires a separately admitted source with complete coverage, deterministic rules and auditable provenance. The current repository evidence does not establish such a source.

## Required next gate

Before any remote migration:

- identify and verify the authoritative source/policy for existing-user lifecycle classification;
- define the exact initial `account_state` policy;
- define the exact initial `account_state_version` policy;
- prove complete row coverage without leaking or exporting unnecessary user data;
- update the migration Contract and execute only after the migration admission gate passes.

## Non-decisions

This decision does not:
- mutate D1;
- modify W01 `Users.ts`;
- implement W02 transition logic;
- create a new Worker or D1;
- promote AUTH-013 to GREEN;
- promote E6 Runtime-003.

## Final disposition

**C selected. AUTH-013 migration execution remains blocked by an explicit data-semantic decision gate, not by an implementation defect.**
