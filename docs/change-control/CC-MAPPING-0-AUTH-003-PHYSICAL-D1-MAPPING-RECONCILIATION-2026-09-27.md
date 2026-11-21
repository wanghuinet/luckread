# CC-MAPPING-0-AUTH-003-PHYSICAL-D1-MAPPING-RECONCILIATION-2026-09-27

## Scope

Reconcile the already-observed AUTH-003 D1-01 physical schema into the canonical D1 schema mapping for the admitted credential-add slice.

## Authority

- Logical ownership: `W02 / D1-01 / ENT-IDENTITY / ENT-CREDENTIAL`
- Migration: `workers/W02-content/migrations/0004_auth_003_credentials.sql`
- Migration execution: run `36296831559`
- Read-only post-migration schema evidence: run `36298629648`
- Runtime evidence: run `36299334577`
- Exact migration/schema source SHA: `52c6868f99ae2ec9aeb8bdceb4a18396cde20435`
- D1-01: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`

## Reconciled mapping

`ENT-IDENTITY` maps to `auth_identities`; `ENT-CREDENTIAL` maps to `auth_credentials`.

The canonical D1 mapping now records the observed column, index and constraint relationships. The composite credential uniqueness boundary is explicitly `(kind, normalized_value)`; `normalizedValue` is not independently unique.

## Disposition

Physical D1 mapping is evidenced for the admitted AUTH-003 slice. This does not promote the feature or entities to GREEN.

Remaining blockers are full AUTH-003 lifecycle evidence (List/Replace/Remove), final Entity/Feature→Entity→Persistence reconciliation, and global Mapping 0/R4/Five-Way closure. No migration or runtime rerun is authorized or required.
