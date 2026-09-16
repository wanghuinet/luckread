# AUTH-003 DTO Wire-Field Matrix v1

Status: `BLOCKED_NOT_GREEN`

## Purpose

Freeze which AUTH-003 data is actually evidenced for public wire DTOs and which items remain unresolved. This document is a contract/audit artifact only; it does not promote implementation, persistence, or security evidence.

## Authority chain

`AUTH-003 feature API contract` → `entity/field authority` → `explicit public projection decision` → `OpenAPI` → `canonical DTO registry` → `Mapping-0`.

No public DTO field may be created merely because a same-named entity field exists.

## Established AUTH-003 operation inventory

- `authCredentialList` — `GET /auth/credentials`
- `authCredentialAdd` — `POST /auth/credentials`
- `authCredentialReplace` — `PUT /auth/credentials/{credentialId}`
- `authCredentialRemove` — `DELETE /auth/credentials/{credentialId}`

Mutating operations require `Idempotency-Key`; all operations are self-scoped and authorization must occur before mutation.

## Field-level evidence

| Candidate field | Existing authority | Public wire status | Reason |
|---|---|---|---|
| `id` | `ENT-CREDENTIAL-F-ID` | `FORBIDDEN/UNRESOLVED` | Internal identifier exposure is not explicitly authorized by the current feature contract. |
| `identityId` | `ENT-CREDENTIAL-F-IDENTITY-ID` | `FORBIDDEN` | Internal relation; must not become a public account-link identifier by inference. |
| `kind` | `ENT-CREDENTIAL-F-KIND` | `UNRESOLVED` | Field exists and allowed values are `username/email/phone`, but public projection is only conditionally allowed by the field contract. |
| `valueHash` | `ENT-CREDENTIAL-F-VALUE-HASH` | `FORBIDDEN` | Secret-derived material. |
| `normalizedValue` | `ENT-CREDENTIAL-F-NORMALIZED-VALUE` | `FORBIDDEN` | Authentication identifier; explicitly never public. |
| `verifiedAt` | `ENT-CREDENTIAL-F-VERIFIED-AT` | `FORBIDDEN/UNRESOLVED` | Verification metadata is conditionally exposable only when explicitly required. No such public requirement is currently contracted. |
| `active` | `ENT-CREDENTIAL-F-ACTIVE` | `UNRESOLVED` | Lifecycle state exists, but the feature contract does not explicitly define it as a public field. |
| `createdAt` | `ENT-CREDENTIAL-F-CREATED-AT` | `UNRESOLVED` | Audit metadata exists; public exposure is not explicitly contracted. |
| `updatedAt` | `ENT-CREDENTIAL-F-UPDATED-AT` | `UNRESOLVED` | Audit metadata exists; public exposure is not explicitly contracted. |

## Request DTO status

### `DTO-AUTH-003-CREDENTIAL-ADD-REQUEST`

The operation contract proves that a credential-add request exists, but does not specify its exact wire field set or requiredness. The likely business inputs are not promoted because the feature contract does not explicitly bind their wire names, formats, or requiredness.

### `DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST`

The operation contract proves that a replace request exists, but does not specify its exact wire field set or requiredness. The path contains `{credentialId}`, but the canonical parameter schema is not yet defined.

## Response DTO status

### `DTO-AUTH-003-CREDENTIAL-LIST-RESPONSE`

The feature contract requires a list response, but does not define its item envelope, cursor fields, item fields, ordering, or limit semantics. No list shape is promoted.

### `DTO-AUTH-003-CREDENTIAL-ADD-RESPONSE`

The response exists as a DTO identity only. No exact public projection is yet authorized.

### `DTO-AUTH-003-CREDENTIAL-REPLACE-RESPONSE`

The response exists as a DTO identity only. No exact public projection is yet authorized.

### `DTO-AUTH-003-CREDENTIAL-REMOVE-RESPONSE`

The response exists as a DTO identity, but body-vs-`204 No Content` semantics are not explicitly contracted.

## Explicit security exclusions

The following must never appear in AUTH-003 public response DTOs:

- credential input values;
- normalized credential values;
- credential hashes;
- internal identity linkage fields;
- secret-derived credential material.

The current field contract explicitly marks normalized values and value hashes as non-public, and all credential material is prohibited from public projections.

## Current closure result

`FIELD_AUTHORITY_FOUND / WIRE_SCHEMA_NOT_CLOSED`

What is already frozen:

1. operation IDs, methods, and paths;
2. DTO identifiers;
3. credential entity/field authority;
4. credential kinds and lifecycle metadata;
5. non-disclosure constraints;
6. authorization and idempotency obligations.

What is still missing before OpenAPI promotion:

1. exact request fields and requiredness;
2. exact response fields and requiredness;
3. public representation of `kind`, if any;
4. list pagination envelope;
5. path parameter schema for `credentialId`;
6. success status semantics;
7. canonical client-error mapping including generic credential conflict;
8. explicit body/no-body semantics for remove;
9. examples only after the schema is approved.

## Gate decision

`NO_OPENAPI_WRITE`

`NO_DTO_REGISTRY_PROMOTION`

`NO_MAPPING_PROMOTION`

Reason: the repository currently provides field authority and security rules but does not yet provide the explicit public wire projection needed to safely create canonical DTO/OpenAPI schemas.