# Change Control: AUTH-004/005 DTO Vocabulary Source Authority — 2026-09-26

- Change Control ID: CC-MAPPING-0-AUTH-004-005-DTO-VOCABULARY-AUTHORITY-2026-09-26
- Status: `APPROVED_RECONCILIATION / VOCABULARY_ONLY`
- Parent checkpoint: `080a0644ce1f4957cfd70c36440822b298f8429f`
- Result commit: `7d147fe52e532f5a0fa948c6532736233282b8a3`
- Backup: `backup/main-before-auth004-005-dto-authority-decision-20260926`

## Authority basis

Existing Mapping 0 authority decisions establish the target chain:

`Blueprint -> feature API contract -> canonical OpenAPI -> DTO registry -> Entity/Field authority -> Mapping`

The canonical DTO registry itself remains sourced from OpenAPI and only binds operations actually present in OpenAPI. This control therefore decides only which source owns the **target DTO vocabulary** before OpenAPI admission.

## Decision

### AUTH-004

The feature API contract is the authoritative target vocabulary source:

- `DTO-AUTH-004-PASSWORD-CHANGE-REQUEST`
- `DTO-AUTH-004-PASSWORD-CHANGE-RESPONSE`
- `DTO-AUTH-004-PASSWORD-RESET-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM`
- `DTO-AUTH-004-PASSWORD-RESET-RESPONSE`

The persistence/reconciliation variants:

- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-RESPONSE`

are stale downstream aliases and are not additional public DTO identifiers.

### AUTH-005

The feature API contract is the authoritative target vocabulary source:

- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE`

The persistence/reconciliation variants:

- `DTO-AUTH-005-VERIFICATION-CONFIRM-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE-REQUEST`
- `DTO-AUTH-005-VERIFICATION-REVOKE-RESPONSE`

are stale downstream aliases and are not additional public DTO identifiers.

## Explicit non-admissions

This decision does **not**:

- invent or freeze request/response field schemas;
- add OpenAPI paths or operations;
- add canonical DTO registry records;
- infer DTOs from Entity or persistence fields;
- authorize runtime or persistence implementation;
- create Evidence Registry claims;
- change Mapping 0 GREEN status.

OpenAPI/DTO promotion remains blocked until the exact wire schemas are explicitly contracted and admitted through the canonical OpenAPI chain.

## Reconciliation result

- AUTH-004 identifier source conflict: `PASS_VERIFIED_VOCABULARY_ONLY`
- AUTH-005 identifier source conflict: `PASS_VERIFIED_VOCABULARY_ONLY`
- AUTH-004 exact wire schema: blocked
- AUTH-005 exact wire schema: blocked
- Runtime/persistence/evidence: blocked
- Mapping 0: `NOT_GREEN`
