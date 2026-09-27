# CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-SCHEMA-RECONCILIATION-2026-09-27

## Status

`IDEMPOTENCY_SCHEMA_RECONCILED / RESPONSE_AND_CONSENT_BINDINGS_BLOCKED`

## Decision

The AUTH-001 registration envelope's idempotency subset is now concretely admitted by reusing the canonical P0 Idempotency Contract. No new idempotency semantics are introduced.

### Frozen persistence fields

- `idempotency_key`
- `scope`
- `endpoint`
- `payload_hash`
- `state`
- `response_digest`
- `created_at`
- `expires_at`

### Frozen semantics

- same key + same payload + COMPLETED returns the first registration result;
- same key + same payload + IN_PROGRESS returns `IDEMPOTENCY_IN_PROGRESS`;
- same key + different payload returns `IDEMPOTENCY_KEY_REUSE_CONFLICT`;
- expired key is a new request;
- the envelope is written in the same transaction as the protected Payload User creation;
- default retention is 24 hours.

## Remaining envelope decisions

Two concrete pieces remain blocked:

1. the exact persistence shape for the committed registration response identity/status required for replay;
2. the concrete binding of request `consent` to the admitted PRIV-002 persistence contract.

The first cannot be invented from `response_digest` because replay must return the original User identity and status. The second cannot be invented while PRIV-002's canonical entity/field contract remains unadmitted.

## Non-authorizations

No collection/table, migration, runtime handler, consent schema, or new infrastructure is authorized by this reconciliation.
