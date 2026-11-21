# CC-MAPPING-0-AUTH-003-NORMALIZED-UNIQUENESS-SEMANTICS-RESOLUTION-2026-09-27

## Decision

`ENT-CREDENTIAL-F-NORMALIZED-VALUE` is **not globally unique as a single field**.

Canonical credential uniqueness is the composite persistence key:

`(kind, normalizedValue)`

## Authority chain

1. API contract `contracts/api/AUTH-003-credential-management-contract.v1.json` explicitly defines uniqueness scope as `[kind, normalizedValue]`.
2. Contractual mapping delta states canonical persistence uniqueness is `(kind, normalizedValue)`.
3. Migration `workers/W02-content/migrations/0004_auth_003_credentials.sql` implements `auth_credentials_kind_normalized_value_uq` on `kind, normalized_value`.
4. Remote schema evidence run `36298629648` verified that admitted index.
5. Remote runtime evidence run `36299334577` proved one-winner concurrent uniqueness for the canonical same-kind credential claim.
6. The entity-field contract's prior `unique=true` on `normalizedValue` was a single-field annotation inconsistent with the authoritative composite uniqueness rule.

## Minimal reconciliation

- Change `ENT-CREDENTIAL-F-NORMALIZED-VALUE.unique` from `true` to `false`.
- Preserve `indexed=true`.
- Preserve composite uniqueness authority in the API/migration contracts.
- No code change.
- No D1 migration.
- No runtime rerun.
- No entity promotion or Mapping 0 GREEN promotion by this change alone.

This closes the semantic contradiction without changing already-tested behavior.
