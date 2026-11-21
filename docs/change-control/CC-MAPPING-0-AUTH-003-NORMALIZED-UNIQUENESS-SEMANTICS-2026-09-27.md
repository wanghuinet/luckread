# CC-MAPPING-0-AUTH-003-NORMALIZED-UNIQUENESS-SEMANTICS-2026-09-27

## Status

`BLOCKED_DECISION_REQUIRED`

## Observed authoritative inputs

- Field contract: `contracts/entity/AUTH-003-credential-field-contract.v1.json`
- Contractual mapping delta: `contracts/alignment/mapping-batches/AUTH-003-contractual-mapping-delta.v1.md`
- Executed migration: `workers/W02-content/migrations/0004_auth_003_credentials.sql`
- Remote schema postcheck: run `36298629648`
- Remote runtime/security evidence: run `36299334577`, exact tested implementation SHA `419bb7fd887af0c30412bead50f8196ec6446bb7`

## Conflict

The field contract declares:

`ENT-CREDENTIAL-F-NORMALIZED-VALUE.normalizedValue.unique = true`

The canonical AUTH-003 contractual mapping declares persistence uniqueness as:

`(kind, normalizedValue)`

The executed migration implements exactly that composite constraint:

`auth_credentials_kind_normalized_value_uq ON auth_credentials(kind, normalized_value)`

It does **not** implement a global unique constraint on `normalized_value`.

## Evidence boundary

Run `36299334577` proved:

- concurrent same-kind email claims yield one winner and one generic conflict;
- one authoritative normalized owner remains;
- cross-account mutation is denied;
- protected credential material is not returned.

That runtime probe does not prove that the same normalized text must be globally unique across different credential kinds, and the existing canonical contract does not require that semantics.

## Disposition

This is a contract-semantics conflict, not an implementation defect to auto-correct.

Until an authoritative decision is recorded:

- do not change `0004_auth_003_credentials.sql`;
- do not change `credential-add.ts` uniqueness behavior;
- do not silently reinterpret `unique=true`;
- do not promote ENT-CREDENTIAL;
- do not mark Mapping 0 GREEN.

## Required decision

Resolve whether `ENT-CREDENTIAL-F-NORMALIZED-VALUE` means:

1. globally unique normalized value, or
2. unique only within the `kind` dimension as defined by the canonical AUTH-003 persistence rule.

The decision must reconcile the field contract with the already-admitted migration design and runtime evidence before implementation continues.
