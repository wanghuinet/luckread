# CC-MAPPING-0-USER-001-PAYLOAD-API-FIELD-RECONCILIATION-2026-09-27

## Status

`FIELD_PROJECTION_RECONCILIATION_BLOCKED`

## Scope

This control reconciles the currently active W01 Payload User fields, the verified ENT-USER field contract, and the current `GET /users/me` / `PATCH /users/me` API surface.

It is a contract/evidence correction only. It does not authorize adding fields, changing OpenAPI, or changing runtime code.

## Current authoritative sources

### Active Payload User fields

Current W01 `workers/W01-payload/src/collections/Users.ts` contains:

- `username` — required, unique, indexed;
- `displayName`;
- `bio`;
- `avatar`;
- `locale` — default `en-US`;
- `timezone` — default `UTC`.

Payload-native authentication fields such as email/password/recovery state exist through the auth-enabled collection, but they are not equivalent to the six contract-owned ENT-USER profile fields.

### ENT-USER field contract

The current entity-field contract marks these six fields VERIFIED:

- username;
- displayName;
- bio;
- avatar;
- locale;
- timezone.

It also declares:

- `account_state` as required/contracted but not verified as a Payload-native field;
- `account_state_version` as required/contracted but not verified as a Payload-native field.

Therefore the user/account lifecycle fields are not yet proven present in the active W01 collection merely because the API contract contains `accountState`.

### Current `/users/me` API representation

The OpenAPI `User` schema currently requires and exposes only:

- `id`;
- `username`;
- `accountState`;
- `layer`.

The same schema does **not** currently project:

- `displayName`;
- `bio`;
- `avatar`;
- `locale`;
- `timezone`.

This is an API projection gap relative to the verified ENT-USER profile field set, but it is not authorization to change the public DTO. The exact response projection must remain governed by the USER/profile contract and DTO authority.

## Field-by-field reconciliation

| Field | Payload W01 source | ENT-USER | /users/me User schema | Disposition |
| --- | --- | --- | --- | --- |
| id | Payload native User ID | canonical | exposed | RECONCILED |
| username | native/custom User field | VERIFIED | exposed | RECONCILED |
| displayName | active W01 field | VERIFIED | not exposed | PROJECTION GAP |
| bio | active W01 field | VERIFIED | not exposed | PROJECTION GAP |
| avatar | active W01 field | VERIFIED | not exposed | PROJECTION GAP |
| locale | active W01 field | VERIFIED | not exposed | PROJECTION GAP |
| timezone | active W01 field | VERIFIED | not exposed | PROJECTION GAP |
| accountState | not declared in active Users.ts | CONTRACTED_NOT_VERIFIED | exposed | SOURCE/IMPLEMENTATION GAP |
| accountStateVersion | not declared in active Users.ts | CONTRACTED_NOT_VERIFIED | not exposed | LIFECYCLE FIELD GAP |
| layer | not an ENT-USER profile field | separate authz/layer authority | exposed | DERIVED AUTHZ FIELD |

## Important distinction

The current user table is **not** simply “missing everything the API has.”

The three categories are:

1. Profile fields that already exist in Payload/ENT-USER but are not represented in the current `User` response schema.
2. Lifecycle fields that are defined by the account-state contract but are not currently declared in the active `Users.ts` source.
3. Authorization-derived `layer`, which should not be copied into ENT-USER merely to make the DTO pass.

Email and phone are also not missing profile fields:

- Payload native email is part of authentication state and is not currently exposed by the `User` response schema.
- Phone is intentionally not present in the active W01 User source; the AUTH-001 native-auth control already blocks inventing a phone field/strategy by inference.

## No automatic implementation

The following changes remain unauthorized by this control:

- adding `account_state` or `account_state_version` to `Users.ts`;
- adding phone to `Users.ts`;
- adding profile fields to the OpenAPI User response without USER-001/DTO authority;
- exposing email or other authentication secrets/identifiers merely for field symmetry;
- creating a second profile entity;
- changing the Payload-native identity boundary.

## Required next reconciliation

Before USER-001 can enter implementation, the governing contract must explicitly settle:

1. whether `GET /users/me` and `PATCH /users/me` should expose/update the six verified profile fields;
2. the authoritative source and persistence boundary for `account_state` and `account_state_version`;
3. whether `layer` remains derived from the authorization resolver, separate from ENT-USER;
4. DTO projection/update rules and server-owned field exclusions;
5. cache, anti-abuse, integration and security-E2E evidence.

Mapping 0 remains `NOT_GREEN`; USER-001 remains `BLOCKED_NOT_GREEN`.
