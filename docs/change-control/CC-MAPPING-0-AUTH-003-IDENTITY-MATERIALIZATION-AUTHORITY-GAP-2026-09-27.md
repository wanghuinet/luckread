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

- The B01 foundation contract states that **User ID is immutable and authoritative across all domains**. Therefore the canonical source for `ENT-IDENTITY.userId` is `ENT-USER.id`; no second User-ID authority may be invented.
- `ENT-IDENTITY.userId -> auth_identities.user_id` is physically admitted on D1-01.
- The canonical account-creation entry point is AUTH-001 `authRegister`; its contract is public, idempotent, anti-abuse protected and bounded to one authoritative account-creation write.
- The current AUTH-001 DTO contract binds only `ENT-USER`. It does not yet authorize a concrete AUTH-001 -> ENT-IDENTITY / ENT-CREDENTIAL field mapping.
- `ENT-IDENTITY` remains PROPOSED.
- Existing Payload `users.email` and `users.username` must not be silently collapsed into the frozen ENT-IDENTITY model.
- AUTH-003 wire/API/DTO authority is closed and must not be reopened.
- AUTH-004 remains Payload-native; no password-recovery implementation is introduced by this control.

## Remaining authority decision belongs to AUTH-001

ENT-IDENTITY should **not** receive a standalone materialization service from AUTH-003. The remaining decision is an AUTH-001 registration mapping gap because `authRegister` is the canonical account-creation boundary and the current registration reconciliation explicitly leaves the following links unresolved:

- `authRegister.identityType / identity -> ENT-IDENTITY` field mapping;
- optional registration `username -> ENT-IDENTITY` field mapping;
- separation of the registration `credential` (password) from username/email/phone credential identity state;
- initial normalization/version source for the identity-side fields;
- subsequent maintenance semantics when AUTH-003 changes login identifiers without exceeding the admitted AUTH-003 single-authoritative-write budget;
- divergence/reconciliation rules between `ENT-USER` and `auth_identities`.

These questions require the AUTH-001 contract/evidence chain to be reconciled before any ENT-IDENTITY runtime implementation is admitted. No choice is inferred from Payload Users fields or from the synthetic runtime harness.

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

The next governed slice is **AUTH-001 registration identity/entity mapping reconciliation**. Only after AUTH-001 explicitly closes the User→Identity/credential field authority may the smallest shared materialization implementation be admitted.

AUTH-003 credential runtime remains closed and must not be reworked merely to manufacture identity authority.

