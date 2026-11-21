# AUTH-003 Request DTO Closure Gate v1

## Status

`PASS_VERIFIED — REQUEST WIRE SCHEMA CLOSED; RUNTIME NOT GREEN`

## Purpose

Close only the evidence-supported portion of the AUTH-003 Add/Replace request DTO contract. This artifact deliberately records unresolved wire decisions instead of inventing fields.

## Authoritative operations

- `authCredentialAdd` — `POST /auth/credentials`
- `authCredentialReplace` — `PUT /auth/credentials/{credentialId}`

Both mutating operations require authenticated self scope and `Idempotency-Key`. Authorization must be evaluated before mutation.

Source: `contracts/api/AUTH-003-credential-management-contract.v1.json`.

## Existing data authority

`contracts/entity/AUTH-003-credential-field-contract.v1.json` establishes internal credential fields and allowed credential kinds:

- `kind` ∈ `username | email | phone`
- `normalizedValue` is never public
- `valueHash` is never public
- `identityId` is internal relation
- credential lifecycle is `ACTIVE | INACTIVE | RETIRED`
- provider-specific email transformations are forbidden unless separately contracted
- phone input normalization is parse/validate as E.164

These are domain/data rules, not by themselves public request-field definitions.

## Request DTO admission matrix

| DTO | Confirmed | Not yet contractually defined |
|---|---|---|
| `DTO-AUTH-003-CREDENTIAL-ADD-REQUEST` | request exists; operation/path/auth/idempotency are fixed; credential kinds are fixed | exact wire field names; requiredness; whether raw credential value is named `value`, `credential`, or another field; whether any display/original value is accepted; validation/error semantics |
| `DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST` | request exists; operation/path/auth/idempotency are fixed; `{credentialId}` path placeholder is fixed | exact wire field names; requiredness; whether replacement accepts kind; whether current credential type can change; exact path parameter format; validation/error semantics |

## Security invariants

The public request contract must not accept server-owned internal fields such as:

- `identityId`
- `valueHash`
- `normalizedValue`
- `verifiedAt`
- `active`
- `createdAt`
- `updatedAt`

unless a future explicit contract declares a field as a client input. No such declaration currently exists.

Raw credential input may be required by the business operation, but its exact wire field name, constraints and transport semantics remain unresolved and therefore must not be fabricated in OpenAPI.

## Required exact decisions before promotion

1. Canonical request field name for the submitted credential value.
2. Whether `kind` is required on Add.
3. Whether `kind` is required/allowed on Replace or is immutable by the path-selected credential.
4. Exact string constraints for username/email/phone wire values, beyond the normalization algorithms already contracted.
5. Exact `credentialId` parameter schema.
6. Whether request bodies reject unknown properties.
7. Exact validation failure response mapping.
8. Exact generic credential-conflict response mapping without account-existence disclosure.

## Gate result

`FIELD_DOMAIN_AUTHORITY_PARTIAL / REQUEST_WIRE_SCHEMA_BLOCKED`

The repository currently proves the operation set and domain rules but does not yet prove the exact Add/Replace request wire shape. Consequently:

- `NO_OPENAPI_WRITE`
- `NO_DTO_REGISTRY_PROMOTION`
- `NO_MAPPING_PROMOTION`

## Next contract action

Close the public request projection decision for `DTO-AUTH-003-CREDENTIAL-ADD-REQUEST` first. Then close Replace semantics, path parameter, and shared validation/error mapping. Only after those decisions are explicit should OpenAPI be modified.

## Evidence boundary

This is contract/audit evidence only. It does not claim runtime, D1, migration, integration, security-E2E, or GREEN evidence.

## Accepted decision — 2026-09-26

DTO-AUTH-003-CREDENTIAL-ADD-REQUEST = { kind, value }, both required, with kind in username|email|phone and value a non-empty string; unknown properties are rejected.

DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST = { value }; credential kind is immutable for the selected credentialId; unknown properties are rejected.

The domain normalization/validation rules remain the existing AUTH-003 contract. No runtime authorization is implied.
