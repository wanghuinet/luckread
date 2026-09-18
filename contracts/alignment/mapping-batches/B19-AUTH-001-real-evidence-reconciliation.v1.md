# B19 — AUTH-001 Real Evidence Reconciliation v1.1

## Status

`BLOCKED_UNTIL_IMPLEMENTATION_AND_PERSISTENCE_EVIDENCE`

## Scope

Canonical feature: `AUTH-001` registration.

Canonical API operation established by current repository contracts: `authRegister` (`POST /auth/register`).

## Evidence discovered

1. `contracts/openapi/v1/openapi.yaml` defines `authRegister` and its request/201 response schemas.
2. `contracts/api/auth-operation-policy.v1.json` defines `authRegister` as public registration with Idempotency-Key, bounded D1 budget, one authoritative write, anti-abuse requirements, and `same-request-replay-must-not-create-second-account` semantics.
3. `contracts/dto/auth-dto-contract.v1.json` now canonically binds `AUTH-001` to `DTO-AUTH-REGISTER-REQUEST` and `DTO-AUTH-REGISTER-RESPONSE`, using the current OpenAPI request and 201 response schemas.
4. `contracts/dto/auth-dto-records.v1.json` records both AUTH-001 DTOs with the same OpenAPI schema references. No runtime implementation claim is made.
5. `contracts/entity/entity-catalog.v1.json` establishes `ENT-USER` as the currently VERIFIED authoritative User entity and points to the declared active W01 runtime authority `workers/W01-payload/src/collections/Users.ts`.
6. `contracts/entity/entity-field-contract.v1.json` establishes the currently VERIFIED User fields: `username`, `displayName`, `bio`, `avatar`, `locale`, and `timezone`. All currently remain `migrationVersion: PENDING_EVIDENCE`.
7. `contracts/payload/payload-native-inventory.v1.json` now discovers the active W01 Payload `users` collection from `workers/W01-payload/src/collections/Users.ts`, where `fields: []`. The six canonical ENT-USER business fields remain contract evidence defined by the entity-field contract and are therefore not yet proven implemented in W01.
8. The repository retains historical scaffold references separately; they do not establish the active implementation. Current W01 `workers/W01-payload/src/collections/Users.ts` has `slug: users`, `auth: true`, and `fields: []`.
9. `workers/W01-payload/src/payload.config.ts` configures `@payloadcms/db-d1-sqlite`, `push: false`, and `migrationDir` under W01.
10. W01 contains a migration source artifact, but repository evidence does **not** establish a controlled-D1 execution result or a complete current W01 field mapping for the canonical ENT-USER contract. Therefore no D1 persistence or six-field implementation claim is made.
11. Repository search does **not** establish a concrete runtime handler bound to `authRegister`. Therefore no handler/runtime claim is made.

## Evidence-supported links

The following links can now be retained as evidence-backed contract mappings:

- `AUTH-001 -> authRegister`
- `AUTH-001 -> DTO-AUTH-REGISTER-REQUEST`
- `AUTH-001 -> DTO-AUTH-REGISTER-RESPONSE`
- `AUTH-001 -> ENT-USER`
- `ENT-USER -> username | displayName | bio | avatar | locale | timezone`
- `ENT-USER -> Payload users`
- `Payload users -> src/collections/Users.ts`
- `Payload D1 adapter -> cloudflare.env.D1`

## Required links that remain unresolved

- AUTH-001 request field -> entity/identity/credential mapping for `identityType`, `identity`, `credential`, optional `username`, and `consent`.
- Account lifecycle persistence for `accountState=PENDING_VERIFICATION`.
- Concrete authoritative D1 table/column/constraint mapping.
- Migration identifier/path and successful execution evidence.
- Concrete API handler/code binding for `authRegister`.
- Registration security and anti-abuse executable enforcement evidence.
- Integration/E2E and negative-path evidence.
- Evidence Registry record bound to executed verification results.
- Canonical Mapping 0 record regeneration from these reconciled inputs.

## Important boundary finding

The current VERIFIED `ENT-USER` model does not itself prove that registration identity/credential material is represented by the six public profile fields. The OpenAPI registration request contains credential-bearing inputs, while the current User field contract only establishes the six listed profile/preference fields. `ENT-IDENTITY` and `ENT-CREDENTIAL` remain PROPOSED. The mapping therefore MUST NOT pretend that registration credentials are stored in `ENT-USER` profile fields.

## Fail-closed rule

This reconciliation MUST NOT promote `AUTH-001` to GREEN. Existing OpenAPI, DTO, Payload, or User-collection evidence is insufficient without the remaining persistence, runtime, lifecycle, security, test, and Evidence Registry chain.

Required chain:

`Feature -> API -> DTO -> Entity -> Field -> Persistence -> Payload -> Code -> Security -> Lifecycle -> Test -> Evidence`

## Next closure action

The next admissible step is to establish the canonical registration implementation boundary and the authoritative persistence contract. Only after real handler/migration evidence exists should Mapping 0 be regenerated and evaluated by the fail-closed validator.
