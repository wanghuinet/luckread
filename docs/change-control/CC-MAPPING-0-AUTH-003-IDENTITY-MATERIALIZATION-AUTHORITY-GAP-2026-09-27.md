# CC-MAPPING-0-AUTH-003-IDENTITY-MATERIALIZATION-AUTHORITY-GAP-2026-09-27

## Status

`GAP_IDENTIFIED / IMPLEMENTATION_NOT_AUTHORIZED`

## Purpose

Freeze the smallest remaining authority gap before implementing any ENT-IDENTITY materialization/runtime slice.

## Observed state

1. `auth_identities` physical schema is admitted on D1-01 through the already-executed AUTH-003 migration and exact-SHA read-only postcheck.
2. AUTH-003 credential runtime requires an existing `auth_identities` row and only reads `id` by `user_id`; List/Replace/Remove also use the identity row as the self-scope boundary.
3. Controlled runtime workflows create synthetic `auth_identities` rows only as test prerequisites and clean them afterward.
4. No production code currently contains an `INSERT INTO auth_identities`, `UPDATE auth_identities`, or an equivalent identity materialization service.
5. No existing authoritative contract in the current main tree explicitly defines the source-of-truth mapping from `ENT-USER` / Payload `users` to every canonical `ENT-IDENTITY` field, especially `phone`, normalized fields, and `normalizationVersion`.

## Closed facts

- `ENT-IDENTITY.userId -> auth_identities.user_id` is physically admitted.
- `ENT-IDENTITY` remains PROPOSED.
- Existing Payload `users.email` and `users.username` must not be silently collapsed into the frozen ENT-IDENTITY model.
- AUTH-003 wire/API/DTO authority is closed and must not be reopened.
- AUTH-004 remains Payload-native; no password-recovery implementation is introduced by this control.

## Required authority input before implementation

The next implementation admission must explicitly settle, using authoritative project contracts:

- canonical upstream owner for `ENT-IDENTITY.userId`;
- source/ownership for username, email and phone;
- exact normalization and versioning source;
- whether identity materialization occurs synchronously during an existing authoritative user lifecycle event or through an already-authorized asynchronous path;
- conflict/reconciliation behavior when upstream User state and `auth_identities` diverge;
- idempotency and concurrency requirements for first materialization;
- exact Worker/D1 ownership and operation budget.

No choice is inferred from current Payload Users fields or from the synthetic runtime harness.

## Non-goals

- No new identity system is implemented here.
- No D1 schema change.
- No migration.
- No API/DTO change.
- No Worker route.
- No Payload auth/recovery modification.
- No entity catalog promotion.
- No Mapping 0 GREEN.

## Next gate

Resolve this authority packet under Change Control. Only then admit the smallest ENT-IDENTITY materialization/runtime implementation and its exact-SHA evidence.
