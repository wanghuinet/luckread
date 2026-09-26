# Change Control: AUTH-005 DTO Identifier Conflict — 2026-09-26

- Change Control ID: CC-MAPPING-0-AUTH-005-DTO-ID-CONFLICT-2026-09-26
- Status: `OPEN_DECISION_REQUIRED / NO_AUTHORITY_CHANGED`
- Scope: AUTH-005 DTO identifier reconciliation only
- Current main: `584e585b09465aa6f14099adc9b5018b72a7eff8`
- Backup: `backup/main-before-auth005-dto-id-conflict-20260926`

## Trigger

Existing AUTH-005 sources disagree on the canonical DTO identifier set. This record preserves the conflict without selecting a winner.

## Variant A — feature API contract

Source:
`contracts/api/AUTH-005-identity-verification-contract.v1.json`

Declared DTOs:
- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE`

## Variant B — shared persistence/API mapping

Source:
`contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`

AUTH-005 binding declares:
- `DTO-AUTH-005-VERIFICATION-REQUEST`
- `DTO-AUTH-005-VERIFICATION-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-CONFIRM-REQUEST`
- `DTO-AUTH-005-VERIFICATION-CONFIRM-RESPONSE`
- `DTO-AUTH-005-VERIFICATION-REVOKE-REQUEST`
- `DTO-AUTH-005-VERIFICATION-REVOKE-RESPONSE`

## Variant C — historical OpenAPI reconciliation artifact

Source:
`contracts/alignment/mapping-batches/AUTH-003-006-openapi-operation-reconciliation.v1.md`

The reconciliation artifact also references the request/response pair variants for confirm and revoke.

## Conflict classification

This is a DTO identifier/source-authority conflict.

Automatic normalization is prohibited because:
- feature-specific API contract is a current authority input;
- shared mapping is a separate canonical mapping input;
- historical reconciliation material preserves a competing identifier set;
- no current authority decision explicitly reconciles these identifiers.

## Required decision

An explicit authority decision must reconcile the canonical DTO identifiers for:
- verification request
- verification confirm
- verification revoke

Until then:
- no AUTH-005 OpenAPI DTO promotion;
- no canonical DTO registry promotion;
- no Mapping 0 promotion;
- no runtime implementation admission from this conflict.

## Non-changes

No API fields, OpenAPI schemas, DTO registry entries, persistence mappings, runtime code, or Evidence Registry claims are modified by this control.

Decision status: `BLOCKED_ON_EXPLICIT_AUTHORITY_DECISION`.
