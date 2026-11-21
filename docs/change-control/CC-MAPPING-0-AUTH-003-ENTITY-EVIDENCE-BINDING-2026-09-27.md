# CC-MAPPING-0-AUTH-003-ENTITY-EVIDENCE-BINDING-2026-09-27

## Scope

Bind already-admitted AUTH-003 persistence/runtime evidence to ENT-IDENTITY and ENT-CREDENTIAL without promoting either entity and without changing code or remote D1.

## Evidence inputs

- Migration: `workers/W02-content/migrations/0004_auth_003_credentials.sql`
- Schema postcheck: run `36298629648`
- Runtime/security: run `36299334577`
- Exact tested implementation SHA: `419bb7fd887af0c30412bead50f8196ec6446bb7`
- Current main at this control: `f1853d3ee29f6f0cf84e8991096be062ea56c98b`
- D1-01: `luckread` / `2f80471e-3756-49f9-8db1-7707a433ad64`

## Binding disposition

- `ENT-IDENTITY`: implementation evidence bound, catalog status remains `PROPOSED`, registry status `BLOCKED`.
- `ENT-CREDENTIAL`: implementation evidence bound, catalog status remains `PROPOSED`, registry status `BLOCKED`.
- AUTH-003 Feature→Entity→Persistence record is added as `BLOCKED`.
- Evidence Registry remains `NOT_GREEN`.

## Important boundary

This is evidence traceability only. It does not authorize:
- entity promotion to VERIFIED;
- Mapping 0 GREEN;
- additional AUTH-003 lifecycle operations;
- migration rerun;
- runtime rerun;
- production Worker deployment.

## Next gate

Validate the updated entity/feature persistence registries, then reconcile the final AUTH-003 entity/field/persistence decision material.