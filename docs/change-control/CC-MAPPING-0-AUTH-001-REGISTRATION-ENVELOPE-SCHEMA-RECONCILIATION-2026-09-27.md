# CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-SCHEMA-RECONCILIATION-2026-09-27

## Status

`RESPONSE_REPLAY_SCHEMA_RECONCILED / CONSENT_BINDING_BLOCKED`

## Decision

The AUTH-001 registration envelope idempotency subset remains concretely admitted by the canonical P0 Idempotency Contract.

The remaining replay-response blocker is now closed at the logical persistence-contract level by reusing the canonical AUTH-001 201 response shape and the already-admitted AUTH-013 User-state bindings.

### Frozen idempotency fields

- `idempotency_key`
- `scope`
- `endpoint`
- `payload_hash`
- `state`
- `response_digest`
- `created_at`
- `expires_at`

### Frozen committed response projection

The envelope MUST retain a lossless logical `committed_response` object with exactly:

- `userId` → `ENT-USER.id`
- `accountState` → `users.account_state`

Authoritative inputs:

- `contracts/openapi/v1/openapi.yaml` — `authRegister` 201 response schema;
- `docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-WRITE-BOUNDARY-2026-09-27.md` — `response.userId` and `response.accountState` field authority;
- `docs/change-control/CC-MAPPING-0-AUTH-001-AUTH-013-INITIAL-PERSISTENCE-RECONCILIATION-2026-09-27.md` — initial `users.account_state=PENDING_VERIFICATION`, version 1;
- `contracts/enums/account-state.json` — canonical AccountState values.

A `COMPLETED` replay returns the canonical HTTP `201` response with the original `committed_response` body. HTTP `201` is fixed by the canonical operation contract and therefore is derived, not a second persisted status field.

This closes the logical replay-shape decision without inventing a physical table, column, index, constraint, or second API response model.

### Remaining envelope blocker

Only the concrete AUTH-001 request `consent` binding remains blocked because PRIV-002 still lacks an admitted canonical entity/schema/field/retention contract.

## Non-authorizations

No collection/table, migration, runtime handler, consent schema, new Worker/D1/Queue, or Mapping 0 GREEN promotion is authorized by this reconciliation.
