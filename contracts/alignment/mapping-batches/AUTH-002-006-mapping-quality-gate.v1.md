# AUTH-002–AUTH-006 Mapping Quality Gate v1.0

## Status

`BLOCKED_NOT_GREEN`

## Purpose

Provide one fail-closed quality gate for the shared AUTH-002 through AUTH-006 mapping before runtime implementation or promotion. This gate protects Mapping-0 from inferred, stale, duplicate, or evidence-free bindings.

## Non-negotiable invariants

1. `DEFINED != MAPPED != IMPLEMENTED != VERIFIED != GREEN`.
2. No mapping row may use an inferred API operation, DTO, entity, field, table, column, index, migration, permission, state, or evidence identifier.
3. Every operation must resolve to the canonical API registry.
4. Every DTO must resolve to the canonical DTO registry.
5. Every entity and field must resolve to the authoritative entity/field contracts.
6. Every persistence owner must resolve to an authoritative D1 mapping or remain explicitly `REQUIRES_VERIFICATION`.
7. Every migration ID is a contract identifier until an executable migration artifact and execution evidence exist.
8. Evidence IDs may not be created merely to satisfy a mapping row; they must reference non-empty executable evidence bound to the tested commit SHA.
9. A second Session identity is forbidden for AUTH-002.
10. Physical D1 table/column/index names remain unresolved until accepted schema evidence establishes them.
11. Mapping-0 must validate every row; partial validation cannot promote the batch.
12. A failed or missing downstream evidence gate keeps the corresponding mapping row non-green.

## Required row shape

Each AUTH row must resolve, as applicable, to:

`feature -> operation -> DTO -> entity -> field -> permission/scope -> lifecycle/state -> persistence owner -> D1 physical mapping -> migration -> runtime evidence -> positive/negative test evidence -> Evidence Registry -> commit SHA`

## Batch closure order

### AUTH-002

Gate-1 remote schema evidence -> native Payload session runtime correlation -> extension persistence -> migration -> security/concurrency E2E -> Evidence Registry -> Mapping-0.

### AUTH-003

Canonical credential API/DTO/entity/field resolution -> normalization/uniqueness persistence evidence -> security/E2E -> Evidence Registry -> Mapping-0.

### AUTH-004

Canonical reset/change API/DTO/entity/field resolution -> recovery-token lifecycle -> session invalidation -> replay/expiry/enumeration security tests -> Evidence Registry -> Mapping-0.

### AUTH-005

Canonical verification API/DTO/entity/field resolution -> challenge lifecycle -> single-use/concurrency/expiry/wrong-purpose tests -> Evidence Registry -> Mapping-0.

### AUTH-006

Canonical passkey API/DTO/entity/field resolution -> RP-ID/origin/challenge persistence -> registration/assertion verification -> negative security tests -> Evidence Registry -> Mapping-0.

## Shared quality checks

Before any row is promoted:

- canonical references resolve;
- no duplicate authoritative entity exists;
- no forbidden secret field is mapped as persistent plaintext;
- persistence ownership is explicit;
- physical schema claims have execution evidence;
- migration claims have execution evidence;
- runtime evidence is produced by the actual implementation;
- negative security tests exist where required;
- concurrency tests exist where required;
- Evidence Registry references are non-empty and commit-bound;
- Mapping-0 validates the exact same commit SHA.

## Batch rule

The batch may be implemented in parallel, but promotion remains per-feature and fail-closed. Passing the mapping quality gate does not imply implementation or verification. No status-only edits may promote any feature.

## Current disposition

`AUTH-002`: BLOCKED_NOT_GREEN
`AUTH-003`: BLOCKED_NOT_GREEN
`AUTH-004`: BLOCKED_NOT_GREEN
`AUTH-005`: BLOCKED_NOT_GREEN
`AUTH-006`: BLOCKED_NOT_GREEN

This document is a quality guardrail, not execution evidence.