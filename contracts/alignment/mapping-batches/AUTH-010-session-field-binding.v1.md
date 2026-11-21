# AUTH-010 Session Field Binding v1

- Feature: `AUTH-010`
- Status: `FIELD_MAPPING_CONTRACTED_PENDING_OPENAPI_RUNTIME`
- Implementation authorization: `false`
- Entity: `ENT-SESSION`
- Entity contract: `contracts/entity/AUTH-002-session-field-contract.v1.json`

## 1. Purpose

Freeze the AUTH-010 public-session field mapping without claiming runtime, persistence, migration, or execution evidence.

## 2. Canonical list DTO mapping

`DTO-AUTH-SESSION-LIST-RESPONSE.items[]` maps only to product-safe `ENT-SESSION` fields:

| DTO field | Entity field | Field ID | Exposure |
|---|---|---|---|
| `sessionId` | `id` | `ENT-SESSION-F-ID` | scoped identifier |
| `deviceId` | `deviceId` | `ENT-SESSION-F-DEVICE-ID` | scoped privacy-sensitive identifier |
| `createdAt` | `createdAt` | `ENT-SESSION-F-CREATED-AT` | scoped audit metadata |
| `expiresAt` | `expiresAt` | `ENT-SESSION-F-EXPIRES-AT` | scoped security metadata |
| `lastSeenAt` | `lastSeenAt` | `ENT-SESSION-F-LAST-SEEN-AT` | scoped security metadata |

`nextCursor` is transport pagination state and is not an `ENT-SESSION` entity field.

## 3. Explicit non-exposure mapping

The following canonical `ENT-SESSION` fields MUST NOT appear in the public session DTO:

- `tokenVersion` → `ENT-SESSION-F-TOKEN-VERSION`
- `refreshCredentialHash` → `ENT-SESSION-F-REFRESH-CREDENTIAL-HASH`
- `revokedAt` → `ENT-SESSION-F-REVOKED-AT`
- `userId` → `ENT-SESSION-F-USER-ID` is authorization scope, not a public list field

This preserves the entity contract's `apiExposure` and credential-material rules.

## 4. Revoke mapping

`authSessionRevoke` consumes:

- Path `sessionId` → `ENT-SESSION-F-ID`
- No request body
- Successful response: HTTP `204`, no response DTO body

The operation authorizes the addressed session against the authenticated caller's `ENT-SESSION-F-USER-ID` ownership before mutation.

The revoke operation does not expose `revokedAt`; that field is authoritative security state and remains internal/scoped.

## 5. Persistence boundary

The existing AUTH-002 native-session decision remains authoritative:

- `id` → Payload native `users.sessions[].id`
- `createdAt` → Payload native `users.sessions[].createdAt`
- `expiresAt` → Payload native `users.sessions[].expiresAt`
- extension dimensions (`deviceId`, `tokenVersion`, `refreshCredentialHash`, `revokedAt`, `lastSeenAt`) → `auth_session_state`

No duplicate `createdAt` or `expiresAt` columns are introduced into `auth_session_state`.

## 6. Gate

This document closes the field-level mapping contract only.

It does NOT prove:

- canonical OpenAPI path existence;
- runtime handler existence;
- authorization enforcement;
- persistence/migration application;
- cache invalidation;
- lifecycle execution;
- integration/security tests;
- Evidence Registry execution evidence.

Therefore AUTH-010 remains **NOT GREEN** and implementation authorization remains `false` until those evidence layers are executed and reconciled.