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


## 2026-09-27 evidence-bound correction — phone source persistence

The earlier registration field table established the **semantic destination** of `identityType=phone` as the phone branch of ENT-IDENTITY and the corresponding AUTH-003 credential kind. That semantic mapping does **not** by itself prove that the submitted phone value has an authoritative durable source in the current registration writer.

Current active W01 `workers/W01-payload/src/collections/Users.ts` declares `username`, `displayName`, `bio`, `avatar`, `locale`, and `timezone`, in addition to Payload's native auth-managed fields. It does not declare a phone field. Therefore the current repository does not establish a durable registration source from which a later W02 identity materializer could recover a phone registration after a delivery failure.

Disposition correction:

- `identityType=email`: semantic destination is established, but runtime/persistence implementation remains unverified.
- `identityType=phone`: semantic destination is established; **durable source persistence is BLOCKED**.
- `username`: semantic destination is established; current Payload User source exists, but synchronization into ENT-IDENTITY/ENT-CREDENTIAL remains unimplemented.

No phone value may be hidden in `username`, consent, or another unrelated User field by inference. No new field or migration is authorized by this correction.

This correction narrows the eventual-consistency decision: before any asynchronous identity materialization can be admitted, the authority for durable registration identity input must explicitly cover the phone branch as well as its replay/recovery semantics.


## 2026-09-27 idempotency source gate

AUTH-001's Idempotency-Key requirement is contractually defined, but current-source inspection does not identify an AUTH-001-specific durable idempotency record or request-fingerprint binding. Existing D1-03 operational idempotency and AUTH-013 publication-journal idempotency are separate scoped authorities and cannot be silently reused.

This blocks safe recovery of a partially materialized registration: a replay must be distinguishable from an unrelated anonymous request using the same identity. Until the idempotency authority, replay semantics and partial-registration recovery semantics are explicitly contracted, `authRegister` implementation remains unauthorized.

Authoritative control: `docs/change-control/CC-MAPPING-0-AUTH-001-IDEMPOTENCY-SOURCE-GATE-2026-09-27.md`.


## 2026-09-27 Payload/Wire compatibility gate

A current-source comparison found a concrete pre-implementation contract mismatch between the AUTH-001 public request and the active Payload User persistence contract.

### Mismatch A — optional username vs required User field

The canonical AUTH-001 OpenAPI request makes `username` optional. The active `ENT-USER-F-USERNAME` contract and W01 `Users.ts` make `username` required, unique and indexed.

No authoritative rule currently defines how a registration request that omits `username` produces the required User username. Deriving a username from email/phone, synthesizing one, or making the field optional would each change a frozen contract and is not authorized by inference.

### Mismatch B — phone registration lacks a User-side durable source

AUTH-001 permits `identityType=phone`. The active W01 Users collection has no phone field. Therefore a later W02 identity materialization cannot recover the original phone identifier from the committed User record after a cross-worker delivery failure.

The semantic destination `ENT-IDENTITY.phone` remains valid, but the current source boundary is not.

### Mismatch C — consent has no admitted persistence authority

The AUTH-001 request contains optional `consent`, while no canonical entity/field persistence authority has been admitted for this request object.

### Disposition

These are contract compatibility blockers, not implementation bugs. No runtime handler should be written until the registration wire contract and Payload User boundary are explicitly reconciled.

The reconciliation must decide, without adding an unnecessary parallel account model:

1. the authoritative rule for omitted username;
2. the durable source for phone registration;
3. the persistence/retention authority for consent;
4. the interaction of these fields with the existing Payload-native password boundary and AUTH-001 idempotency semantics.

Mapping 0 remains NOT_GREEN.


## 2026-09-27 native-auth identity boundary

Current-source inspection further narrows the registration mismatch. W01 `Users.ts` uses Payload native `auth: true` without an admitted custom phone authentication strategy. The repository's Payload reference creation path is email/password based, while AUTH-001 wire permits `identityType=phone`.

Therefore phone registration cannot currently be treated as a pure Payload-native User creation path. No fake email, username substitution, hidden phone field, custom auth strategy, or parallel User/auth system is authorized by inference.

This finding is coupled with the already-recorded username-required-vs-wire-optional mismatch, missing consent persistence authority, missing AUTH-001 durable idempotency authority, and unresolved registration atomic-vs-eventual consistency model.

Authoritative control: `docs/change-control/CC-MAPPING-0-AUTH-001-NATIVE-AUTH-IDENTITY-BOUNDARY-2026-09-27.md`.


## 2026-09-27 evidence-bound correction — active W01 User source and Payload native capability

The older evidence summary above contains a stale observation that `workers/W01-payload/src/collections/Users.ts` had `fields: []`. That statement must not be used as current-head evidence.

At current `main` source head `7f508d76527ffa1a1740e749a6727c52514e4080`, the active W01 `Users.ts` contains these application fields:

- required unique indexed `username`;
- `displayName`;
- `bio`;
- `avatar`;
- `locale` default `en-US`;
- `timezone` default `UTC`.

Payload native auth remains enabled, with native password/recovery behavior and no custom phone authentication strategy.

The current W01 package is pinned to Payload `3.87.1`.

Payload's current authentication capability documentation also confirms that:

- `auth.loginWithUsername` is a native configuration option for username/password login;
- `loginWithUsername.requireEmail=false` permits username-based account creation without requiring an email;
- custom authentication strategies are an advanced extension point and are not necessary solely to enable native username/password authentication.

This capability finding does not authorize a code or wire change. It narrows the AUTH-001 decision:

- the username side does not require a parallel authentication subsystem;
- the current blocker is the public `authRegister.username` optionality versus the already-required W01/ENT-USER username;
- phone registration still lacks an admitted durable source/authentication contract;
- consent, durable Idempotency-Key/replay authority, and the atomic registration writer boundary remain blocked.

Authoritative capability reconciliation:
`docs/change-control/CC-MAPPING-0-AUTH-001-PAYLOAD-NATIVE-CAPABILITY-RECONCILIATION-2026-09-27.md`

Mapping 0 remains NOT_GREEN.


## 2026-09-27 native-email entry correction

Current AUTH-001 public registration identity entry is `identityType=email`.

Phone is deferred to the AUTH-003/AUTH-005 credential and verification path. The previous phone-entry reconciliation text is historical decision material and does not authorize a phone registration runtime.

Authoritative control: `docs/change-control/CC-MAPPING-0-AUTH-001-NATIVE-EMAIL-REGISTRATION-DECISION-2026-09-27.md`.

## 2026-09-27 registration writer-boundary reconciliation

The registration writer boundary is now explicitly reconciled as a W01 Payload-native transaction containing the User creation and a registration-local idempotency/envelope record, followed by eventual W02/D1-01 Identity/Credential materialization.

Authoritative control: `docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-WRITER-BOUNDARY-2026-09-27.md`.

Consent persistence remains unresolved under PRIV-002; no runtime implementation is admitted.

## 2026-09-27 lifecycle dependency clarification

AUTH-001 writer-boundary reconciliation does not promote W01 account lifecycle persistence. The initial `PENDING_VERIFICATION` state remains dependent on the separate AUTH-013 persistence migration/admission and must not be inferred from the API response contract.

AUTH-001 implementation therefore remains blocked on both PRIV-002 consent authority and AUTH-013 lifecycle persistence admission.
