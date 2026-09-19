# CC-MAPPING-0-AUTH-006-ALIAS-AND-DOMAIN-CONFLICT-2026-09-19

## Status

DECIDED — RECONCILIATION PENDING

## Verified facts

### DTO alias conflict

AUTH-006 feature-contract/OpenAPI-promotion materials use:

- `DTO-AUTH-006-REGISTRATION-OPTIONS`
- `DTO-AUTH-006-REGISTRATION-VERIFY`
- `DTO-AUTH-006-ASSERTION-OPTIONS`
- `DTO-AUTH-006-ASSERTION-VERIFY`
- `DTO-AUTH-006-REMOVE`

The shared AUTH-002..006 persistence mapping uses:

- `DTO-AUTH-006-PASSKEY-REGISTRATION-OPTIONS`
- `DTO-AUTH-006-PASSKEY-REGISTRATION-VERIFY`
- `DTO-AUTH-006-PASSKEY-ASSERTION-OPTIONS`
- `DTO-AUTH-006-PASSKEY-ASSERTION-VERIFY`
- `DTO-AUTH-006-PASSKEY-REMOVE`

Existing AUTH-003..006 authority-gate documentation already classifies these as unreconciled aliases.

### Persistence-domain naming conflict

The AUTH-006 B01 reconciliation baseline records a D1 domain naming conflict between `D1-01` and the frozen baseline's `D01 Core`.

The shared AUTH-002..006 persistence mapping currently carries `persistenceDomainId: D1-01`.

No physical D1 schema inference is permitted from either name.

## Required decision

The authoritative vocabulary must be resolved through Change Control before:
- OpenAPI admission;
- canonical DTO registration;
- persistence mapping promotion;
- runtime implementation.

Dependent artifacts must then be reconciled together.

## Gate impact

- AUTH-006 remains MISSING / fail-closed.
- No DTO alias is promoted.
- No D1 domain name is treated as physical schema evidence.
- No runtime implementation is authorized.

## Evidence

- `contracts/alignment/mapping-batches/AUTH-003-006-openapi-authority-gate.v1.md`
- `docs/MAPPING-0-AUTH-TECHNICAL-CLOSURE-QUEUE-2026-09-18.md`
- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`
- `contracts/api/AUTH-006-passkey-webauthn-contract.v1.json`

No canonical mapping or implementation status is changed by this record.

## Decision accepted — 2026-09-20

Decision 5 accepted: canonical AUTH-006 DTO names are the non-PASSKEY identifiers; logical domain follows D01 Core.
