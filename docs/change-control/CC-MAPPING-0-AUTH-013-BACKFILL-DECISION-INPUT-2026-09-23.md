# AUTH-013 Existing-User Backfill Decision Input — 2026-09-23

- Feature: `AUTH-013`
- Persistence target: D1-01 / `users`
- Status: `DECISION_INPUT — BLOCKED_NOT_GREEN`
- Worker authority: W02
- Migration Contract: `MIG-AUTH-013-ACCOUNT-STATE-V1`

## Why a decision is required

The Account State Machine defines the lifecycle and transition graph, including its registration initial state `UNREGISTERED`, but it does not define how already-persisted User rows must be initialized when the new persisted fields are introduced.

The observed D1-01 pre-schema evidence from workflow run `35657959095` proves that `users` currently has no `account_state` or `account_state_version` columns.

A migration against an already-populated table therefore cannot silently choose initial values.

## Decision inputs

The project must explicitly admit both:

1. the initial `account_state` policy for every pre-existing User row;
2. the initial `account_state_version` policy for every pre-existing User row.

The implementation may not derive these values from cache, Payload role, subscription, entitlement, verification status, session state, or any other non-authoritative source unless that source is separately admitted by Contract.

## Candidate policy shapes

These are decision material only; none is selected by this packet.

### Candidate A — Uniform initialized state

Choose one lifecycle state as the migration baseline for all existing rows and assign one explicit initial version.

This is simple operationally but requires an explicit statement that the chosen lifecycle state accurately represents every existing User row.

### Candidate B — Authoritative per-row derivation

Define an authoritative pre-migration classification source and deterministically derive each existing User row's lifecycle state and initial version from it.

This avoids a blanket state assignment but requires a separately admitted source, mapping rules, and evidence proving complete row coverage.

### Candidate C — Migration-only transitional state

Introduce the columns in a temporary compatibility state, perform the application-controlled initialization before final non-null enforcement, then close the migration against a fully verified final schema.

This still requires an explicit source/policy for the values written during initialization; the transitional shape does not remove the decision requirement.

## Non-decisions

This packet does not select a candidate, choose an initial state/version, authorize remote mutation, or promote AUTH-013.

## Acceptance boundary

Once the initial state/version policy is explicitly admitted, the migration Contract may be finalized for execution, then the controlled D1-01 migration and exact post-schema verification can proceed.
