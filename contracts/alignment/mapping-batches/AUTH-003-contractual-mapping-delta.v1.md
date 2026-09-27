# AUTH-003 Contractual Mapping Delta v1.0

## Status

`CONTRACTED_PARTIAL / NOT_GREEN`

## Purpose

Record the newly closed contractual traceability for AUTH-003 without promoting runtime, persistence, test, or evidence state.

## Canonical feature

- Feature: `AUTH-003`
- Name: username/email/phone credentials
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

## API operations

- `authCredentialList` — `GET /auth/credentials`
- `authCredentialAdd` — `POST /auth/credentials`
- `authCredentialReplace` — `PUT /auth/credentials/{credentialId}`
- `authCredentialRemove` — `DELETE /auth/credentials/{credentialId}`

Canonical API contract: `contracts/api/AUTH-003-credential-management-contract.v1.json`

## DTOs

- `DTO-AUTH-003-CREDENTIAL-LIST-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-ADD-REQUEST`
- `DTO-AUTH-003-CREDENTIAL-ADD-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST`
- `DTO-AUTH-003-CREDENTIAL-REPLACE-RESPONSE`
- `DTO-AUTH-003-CREDENTIAL-REMOVE-RESPONSE`

## Entities

- `ENT-IDENTITY` — proposed canonical authority; requires runtime/persistence evidence.
- `ENT-CREDENTIAL` — proposed canonical authority; requires runtime/persistence evidence.

## Field contract

`contracts/entity/AUTH-003-credential-field-contract.v1.json`

The contract freezes the following field identities:

- `ENT-CREDENTIAL-F-ID`
- `ENT-CREDENTIAL-F-IDENTITY-ID`
- `ENT-CREDENTIAL-F-KIND`
- `ENT-CREDENTIAL-F-VALUE-HASH`
- `ENT-CREDENTIAL-F-NORMALIZED-VALUE`
- `ENT-CREDENTIAL-F-VERIFIED-AT`
- `ENT-CREDENTIAL-F-ACTIVE`
- `ENT-CREDENTIAL-F-CREATED-AT`
- `ENT-CREDENTIAL-F-UPDATED-AT`

## Deterministic normalization contract

- username: trim → Unicode NFC → casefold.
- email: trim → Unicode NFC → casefold; provider-specific transformations require a separate explicit contract and are not inferred.
- phone: parse and validate as E.164.

## Uniqueness contract

Canonical persistence uniqueness is `(kind, normalizedValue)`.
Concurrent claims of the same canonical credential must resolve to a single authoritative owner; conflict responses must not disclose protected account existence.

## Authorization contract

All credential-management operations are self-scoped to the authenticated subject. Authorization must be evaluated before mutation. Cross-account management is denied.

## Secret and projection rules

Credential input values, normalized values and derived credential hashes are never returned in public projections and must not be logged.

## Lifecycle

Credential states are `ACTIVE`, `INACTIVE`, `RETIRED`. Replacement cannot make a new credential authoritative until validation and any required verification step succeeds. Removal must preserve an explicit safe recovery path when the credential is the account's only login method.

## Current evidence disposition

The following are now evidenced and admitted for the `authCredentialAdd` persistence/runtime slice:

- D1-01 physical schema/migration evidence for `auth_identities` and `auth_credentials`.
- Exact-SHA credential-add runtime evidence.
- Normalization, persistence uniqueness, idempotent replay/conflict, cross-account denial, public projection and concurrency/security-negative checks.
- Durable Evidence Registry entries `EVD-AUTH003-B15` through `EVD-AUTH003-B18`.

These admissions do **not** make the full AUTH-003 lifecycle GREEN because List/Replace/Remove remain unverified and final Entity/Feature→Entity→Persistence/Mapping 0 promotion remains open.

## Still blocking GREEN

1. Full AUTH-003 lifecycle evidence for `authCredentialList`, `authCredentialReplace` and `authCredentialRemove`.
2. Final field-by-field Entity/Feature→Entity→Persistence reconciliation and entity catalog promotion.
3. Final Mapping 0/R4/Five-Way reconciliation; current global Mapping 0 remains NOT_GREEN.
4. Any remaining lifecycle/security evidence required by the frozen contracts.

`CONTRACTED_PARTIAL` remains the maximum valid overall feature state until those downstream gates close.
