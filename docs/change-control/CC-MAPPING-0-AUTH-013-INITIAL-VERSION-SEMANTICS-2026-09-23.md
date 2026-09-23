# AUTH-013 — Initial Persisted Account-State Version Semantics — 2026-09-23

- Change Control: `CC-MAPPING-0-AUTH-013-INITIAL-VERSION-SEMANTICS-2026-09-23`
- Feature: `AUTH-013`
- Decision status: `APPROVED_DECISION / CONTRACT_ADMITTED`
- Authority: W02 / D1-01
- Entity: `ENT-USER`

## Decision

The account lifecycle state machine keeps `UNREGISTERED` as its logical pre-registration state. The first persisted `User` record is created by the accepted registration transition and therefore persists as:

- `account_state = PENDING_VERIFICATION`
- `account_state_version = 1`

A successful subsequent account-state transition from version `N` MUST persist exactly `N + 1`.

This establishes a deterministic, monotonic, non-zero version base without changing the existing state machine or adding a new lifecycle state.

## Version rules

1. First persisted lifecycle state: `PENDING_VERIFICATION`, version `1`.
2. Every successful state-machine transition: previous version + 1.
3. Invalid, forbidden, rejected, failed-precondition, stale-`If-Match`, or otherwise unsuccessful transitions: no state/version mutation.
4. A transition is authoritative only when W02 persists the state change in D1-01.
5. `account_state_version` is internal lifecycle/security metadata and is not added to the public transition DTO.
6. The version change remains coupled to the existing cache invalidation rule: account-state change increments the version and makes the previous authorization-cache version unreachable.
7. The state-machine transition set remains the sole authority for legal state changes; no self-transition or shortcut is inferred.

## Existing-user boundary

The current controlled D1-01 target was independently verified at workflow run `35852723250` with `users_count = 0`. Therefore the existing-user classification requirement is satisfied for this exact target as `0/0`.

This decision is **not** a blanket backfill rule for a future non-empty target. If a controlled target contains pre-existing User rows, migration admission must stop until a complete authoritative classification policy is separately established.

## Migration admission effect

The staged AUTH-013 migration may now be admitted **only for the currently verified zero-user D1-01 target**. The migration must:

- verify the exact W02 / D1-01 binding;
- verify `users_count = 0` immediately before mutation;
- verify the target lifecycle columns are absent before mutation;
- add the final columns with the admitted initialization semantics;
- capture exact post-migration schema and D1 migration evidence.

No remote mutation is performed by this Change Control itself.

## Explicit non-decisions

This decision does not:

- implement `transitionAccountState`;
- authorize direct W01 business-state writes;
- add lifecycle fields to W01 `Users.ts`;
- create a new D1 or Worker;
- promote AUTH-013 to GREEN;
- promote E6 Runtime-003.

## Next gate

`AUTH-013 → controlled zero-row migration execution → post-schema evidence → W02 transition implementation → security/concurrency/audit/event tests → Evidence Registry promotion.`
