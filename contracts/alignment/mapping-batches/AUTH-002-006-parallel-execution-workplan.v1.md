# AUTH-002–AUTH-006 Parallel Execution Workplan v1.0

## Status

`IMPLEMENTATION_READY / EVIDENCE_PENDING`

## Objective

Batch implementation without weakening canonical Mapping-0 quality. Work may proceed in parallel only where dependencies are already contractually closed.

## Batch 1 — Shared foundation

- canonical API/DTO/entity/field resolution;
- shared persistence adapter boundary;
- Evidence Registry schema and commit binding;
- Mapping-0 validator execution harness;
- common negative-security test harness.

## Batch 2 — AUTH-002 / AUTH-003

### AUTH-002

Implement only the admitted architecture:

`Payload native session identity -> minimal extension state -> single authorization decision`.

Do not create a parallel canonical Session table. Do not duplicate native `createdAt` or `expiresAt`. Do not claim D1 physical names before schema evidence.

### AUTH-003

Implement deterministic normalization and authoritative uniqueness. Credential material must remain non-public and secret material must never be exposed through DTOs or persistence evidence.

## Batch 3 — AUTH-004 / AUTH-005

Implement password recovery and verification lifecycles using the already-defined entity/field contracts. Preserve single-use, time-bound, purpose-bound and non-disclosure invariants. Session invalidation semantics must be explicit for successful password recovery.

## Batch 4 — AUTH-006

Implement passkey registration/assertion boundaries only after RP-ID, origin, challenge, credential ownership and private-key persistence rules resolve to canonical contracts.

## Batch 5 — Evidence

For each completed feature:

1. execute unit/integration tests;
2. execute required negative/security tests;
3. execute concurrency tests where required;
4. capture actual persistence/migration evidence;
5. bind evidence to exact commit SHA;
6. register Evidence IDs;
7. run Mapping-0 against every affected row.

## Parallelism rule

Implementation can be parallelized across independent features, but a feature cannot consume an unresolved mapping as though it were verified. If a dependency is unresolved, the implementation must stop at the declared contract boundary rather than inventing a substitute.

## Promotion rule

No AUTH feature becomes GREEN because implementation exists. GREEN requires complete authoritative mapping plus executable runtime/persistence/security evidence plus Evidence Registry plus same-SHA Mapping-0 validation.
