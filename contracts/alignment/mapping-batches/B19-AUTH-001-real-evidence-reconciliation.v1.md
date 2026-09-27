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

## Resolved authority subset

The B01 foundation contract establishes that **User ID is immutable and authoritative across all domains**. Therefore the AUTH-001 identity/entity mapping has one closed subset:

- `ENT-USER.id -> ENT-IDENTITY.userId -> auth_identities.user_id`

This closes the User-ID source question only. It does not resolve the remaining registration identity/credential field mappings for `identityType`, `identity`, `credential`, optional `username`, consent, normalization/versioning, or account-state persistence.

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

- AUTH-001 request field -> entity/identity/credential mapping for `identityType`, `identity`, `credential`, optional `username`, and `consent` (User-ID authority is separately resolved as `ENT-USER.id -> ENT-IDENTITY.userId`).
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

The next admissible step is to establish the canonical registration implementation boundary and the authoritative persistence contract for the remaining registration identity/credential fields. Do not reopen the now-closed User-ID authority question. Only after real handler/migration evidence exists should Mapping 0 be regenerated and evaluated by the fail-closed validator.


## Registration field authority reconciliation

The following subset is now contract-reconciled without claiming implementation:

| AUTH-001 request field | Canonical destination | Disposition |
| --- | --- | --- |
| identityType | selects ENT-IDENTITY.email or ENT-IDENTITY.phone; corresponding ENT-CREDENTIAL.kind is email or phone | CONTRACT-RECONCILED |
| identity | value for the selected email/phone identity; normalized form follows AUTH-003 deterministic normalization rules | CONTRACT-RECONCILED |
| username | ENT-IDENTITY.username and corresponding ENT-CREDENTIAL.kind=username when supplied | CONTRACT-RECONCILED |
| credential | Payload native authentication password material on ENT-USER; not an ENT-CREDENTIAL username/email/phone row | CONTRACT-RECONCILED |
| consent | no canonical persistence entity/field is currently admitted for this request object | UNRESOLVED / BLOCKED |
| response userId | ENT-USER.id, also the immutable cross-domain source for ENT-IDENTITY.userId | CONTRACT-RECONCILED |
| response accountState | ENT-USER.account_state; first persisted registration state is PENDING_VERIFICATION, version 1 under the existing AUTH-013 account-state contract | PERSISTENCE CONTRACT RECONCILED; RUNTIME REGISTRATION UNVERIFIED |

The password disposition follows the existing Payload-native authentication boundary. The active W01 Users collection is auth-enabled, and Payload documents password as an authentication field rather than a custom application credential entity. Payload also supports native username/email authentication configuration.

## Registration writer-boundary conflict

The remaining blocking decision is the write boundary, not the field vocabulary.

AUTH-001 currently declares:

- resource class: SINGLE_AUTHORITATIVE_WRITE;
- D1 writes max: 1;
- outbound/RPC max: 0;
- same-request replay must not create a second account.

The reconciled field model simultaneously requires, for a complete registration outcome:

1. one authoritative ENT-USER account creation through the existing Payload auth boundary;
2. one ENT-IDENTITY row in auth_identities;
3. zero or more initial ENT-CREDENTIAL identifier rows in auth_credentials;
4. ENT-USER.account_state=PENDING_VERIFICATION.

The current repository does not contain an admitted single-writer mechanism that atomically owns all of those writes. Splitting the work across W01 Payload creation plus a second W02 D1 write would violate the existing AUTH-001 outboundMax=0 / single-authoritative-write contract unless a new Change Control decision explicitly changes that boundary.

Therefore:

- no registration runtime implementation is authorized by this reconciliation;
- no cross-Worker registration RPC is invented;
- no second identity service is introduced;
- no direct replacement of Payload native password handling is introduced.

The next Change Control must resolve where the single authoritative registration write occurs while preserving Payload-native password handling and the frozen AUTH-001 budget.

## Closed registration sub-gates

Closed:

- ENT-USER.id -> ENT-IDENTITY.userId -> auth_identities.user_id;
- registration password -> Payload native auth credential material, not ENT-CREDENTIAL;
- response.userId -> ENT-USER.id;
- response.accountState -> users.account_state;
- first persisted account state contract -> PENDING_VERIFICATION, version 1.

Still blocked:

- canonical consent persistence/authority;
- atomic/single-writer registration boundary across User + Identity + Credential persistence;
- concrete authRegister handler;
- registration security/anti-abuse executable evidence;
- integration/E2E and Evidence Registry admission.

AUTH-001 remains BLOCKED_UNTIL_IMPLEMENTATION_AND_PERSISTENCE_EVIDENCE; Mapping 0 remains NOT_GREEN.


## 2026-09-27 transport reconciliation

The previously identified registration writer-boundary gap is now narrowed by the existing canonical transport authority. W01 is the public API/Gateway boundary, W02 is the D1-01 identity/account authority, and the W01 -> W02 HTTP Service Binding is already admitted and runtime-verified for governed AUTH/T01/T03 calls. AUTH-001 `rpcMax=1` therefore permits one internal call; `outboundMax=0` does not prohibit that internal Service Binding.

The remaining blocker is not transport availability. It is the lack of an admitted atomic persistence contract spanning Payload-native User creation in W01 and ENT-IDENTITY / ENT-CREDENTIAL persistence in W02/D1-01 under AUTH-001 `d1WriteMax=1`. No cross-worker transaction or compensating write sequence is inferred.

Authoritative control: `docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-TRANSPORT-AND-ATOMICITY-2026-09-27.md`.
