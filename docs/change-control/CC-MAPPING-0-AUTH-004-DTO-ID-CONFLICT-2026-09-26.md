# Change Control: AUTH-004 DTO Identifier Conflict — 2026-09-26

- Change Control ID: CC-MAPPING-0-AUTH-004-DTO-ID-CONFLICT-2026-09-26
- Status: `OPEN_DECISION_REQUIRED / NO_AUTHORITY_CHANGED`
- Scope: AUTH-004 DTO identifier reconciliation only
- Current main: `424062142a4bb9df6333c60be389bdd66fb24b5b`
- Backup: `backup/main-before-auth004-dto-id-conflict-20260926`

## Trigger

A concrete identifier conflict was found in existing AUTH-004 mapping sources. This is recorded as decision material only; no side is selected or promoted.

## Observed variants

### Variant A — feature API contract

Source:
`contracts/api/AUTH-004-password-recovery-contract.v1.json`

The feature API contract declares:
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM`
- `DTO-AUTH-004-PASSWORD-RESET-RESPONSE`

### Variant B — shared persistence/API mapping

Source:
`contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`

The AUTH-004 binding declares:
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-RESPONSE`

### Variant C — historical OpenAPI-operation reconciliation artifact

Source:
`contracts/alignment/mapping-batches/AUTH-003-006-openapi-operation-reconciliation.v1.md`

This artifact also references:
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-REQUEST`
- `DTO-AUTH-004-PASSWORD-RESET-CONFIRM-RESPONSE`

## Conflict classification

This is a DTO identity/source-authority conflict.

It is **not** safe to normalize automatically because:
- the feature API contract is a current authority input;
- the shared persistence mapping is a separate canonical mapping input;
- repository governance requires unresolved contract conflicts to remain blocked and become decision material;
- no current authoritative decision artifact establishes which identifier set is canonical.

## Required decision

An explicit authority decision must choose or otherwise reconcile the canonical AUTH-004 reset-confirm request/response DTO identifiers.

Until that decision exists:
- no OpenAPI DTO promotion is authorized for AUTH-004;
- no DTO registry promotion is authorized for AUTH-004;
- no Mapping 0 GREEN claim is authorized;
- no runtime implementation is authorized from this conflict alone.

## Non-changes

This record does not:
- modify AUTH-004 API semantics;
- modify OpenAPI;
- modify DTO registry bindings;
- modify persistence mappings;
- infer fields or schemas;
- create Evidence Registry claims.

Decision status: `BLOCKED_ON_EXPLICIT_AUTHORITY_DECISION`.
