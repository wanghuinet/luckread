# CC-MAPPING-0-AUTH-003-FIELD-WIRE-PROJECTION-RECONCILIATION-2026-09-26

Status: `APPROVED_RECONCILIATION`

## Scope

Reconcile the already-approved AUTH-003 public wire projection with the AUTH-003 credential entity field contract.

## Authority

- Wire authority: `docs/change-control/CC-MAPPING-0-AUTH-003-WIRE-PROJECTION-AUTHORITY-2026-09-26.md`
- Machine wire authority: `artifacts/mapping-0/auth-003-wire-projection-authority-2026-09-26.json`
- API contract: `contracts/api/AUTH-003-credential-management-contract.v1.json`
- Field contract: `contracts/entity/AUTH-003-credential-field-contract.v1.json`

## Observed conflict

The approved AUTH-003 public credential projection is exactly:

`credentialId`, `kind`, `active`.

The credential field contract previously marked:
- `kind` with `apiExposure: NONE`
- `active` with `apiExposure: NEVER`

That wording conflicts with the already-explicit AUTH-003 wire authority.

## Decision

Align the field contract to the explicit AUTH-003 wire authority only:

- `kind` is public **only** in the AUTH-003 credential resource projection.
- `active` is public **only** in the AUTH-003 credential resource projection.
- No other credential metadata becomes public.
- `valueHash`, `normalizedValue`, `identityId`, verification metadata and credential material remain non-public.
- This reconciliation does not promote ENT-CREDENTIAL or ENT-IDENTITY to canonical.
- This reconciliation does not authorize Worker/D1 implementation, migration, runtime evidence, or Evidence Registry promotion.

## Required changes

Update only `contracts/entity/AUTH-003-credential-field-contract.v1.json` public exposure annotations and source references.

## Evidence boundary

This is a contract reconciliation only. It creates no runtime evidence and must not be used as runtime/D1 proof.

## Gate outcome

`AUTH-003 FIELD↔WIRE RECONCILIATION = PASS_VERIFIED_SOURCE_ONLY`

Mapping 0 remains NOT_GREEN.
