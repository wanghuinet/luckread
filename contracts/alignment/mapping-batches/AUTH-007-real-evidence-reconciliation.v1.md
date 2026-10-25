# AUTH-007 Real Evidence Reconciliation v1.0

- Feature: `AUTH-007`
- Name: MFA
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability contract: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Entity authority: `contracts/entity/entity-catalog.v1.json`
- Field authority: `contracts/entity/entity-field-contract.v1.json`
- Security authority: `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`
- Authorization authority: `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md` + `docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`

## 1. Confirmed contract evidence

1. `AUTH-007` is an explicitly inventoried Blueprint capability: MFA. fileciteturn297file0L2-L13
2. B01 defines the capability as enrolling, challenging and verifying a configured additional authentication factor. Enrollment/recovery must be scoped to the authenticated identity and protected against replay. fileciteturn297file3L39-L48
3. The API domain audit explicitly requires an `mfa` authentication family and identifies the MFA/factor contract as a blocking gap. fileciteturn268file0L1-L5
4. The Security Center contract includes MFA / step-up verification and requires sensitive mutations to carry step-up policy, idempotency and audit. fileciteturn275file0L1-L3
5. L5/L6 instance registry contains concrete MFA-adjacent claims `passkey-register-01` and `passkey-auth-01`, but it does not establish a complete MFA contract or executable evidence for this feature. fileciteturn294file0L1-L13
6. The security threat model requires MFA as part of brute-force defense and explicitly requires MFA for L5+ privileged roles. fileciteturn270file0L1-L13
7. The canonical L0-L8 model sets MFA as required for L5, L6, L7 and L8. fileciteturn272file0L1-L5
8. The canonical identity/entity model separates `Credential` from `User` and explicitly allows Credential to represent authentication material, but the Credential entity and fields remain PROPOSED rather than verified. fileciteturn290file0L1-L3 fileciteturn286file0L1-L5
9. The initial reconciliation finding that MFA operation IDs and runtime adapters were absent is superseded by the current source slice: all six canonical W01 MFA routes (status, enrollment start/confirm, challenge verification, disable, recovery-code rotation) are present, W02 owns factor/identity persistence, and W02's persisted TOTP replay guard has SQLite conditional-update and concurrency unit tests. W01 route-level integration tests and W02 handler tests are present in CI. These prove implementation and local test coverage only; they do not prove production schema installation, deployed cross-Worker behavior, or security E2E acceptance.

## 2. Missing canonical traceability

- Canonical API/DTO contract: `contracts/api/AUTH-007-mfa-totp-contract.v1.json` defines W01 public operation IDs, DTOs, factor lifecycle requirements, audit-event requirements, no-store behavior and security invariants. The six operations are bound to OpenAPI and the DTO/policy/inventory registries, and source adapters/tests now exist. The contract remains `CONTRACTED_NOT_VERIFIED` because production runtime, persistence and accepted security evidence are not complete.
- MFA enrollment-start DTO: defined in `AUTH-007-mfa-totp-contract.v1.json` and registered; runtime/evidence admission remains incomplete.
- MFA enrollment-confirm DTO: defined and registered; production and security evidence remains incomplete.
- MFA challenge DTO: defined and registered; challenge expiry, single-use and security E2E evidence remains incomplete.
- MFA verification DTO: represented by the canonical challenge-verify request/response DTOs; exact-SHA security evidence remains incomplete.
- MFA enrollment and recovery result DTOs: defined in the canonical API contract; one-time disclosure and deployed rotation evidence remain incomplete.
- MFA factor entity ID: proposed as `ENT-MFA-FACTOR` in `contracts/entity/entity-catalog.v1.json`; the catalog status remains `PROPOSED` and is not promoted to canonical.
- Factor field contract: `contracts/entity/AUTH-007-mfa-factor-field-contract.v1.json` has been added with status `CONTRACTED_NOT_VERIFIED`; the global entity field catalog remains `NOT_GREEN` and schema/read-back evidence is missing.
- Factor status/lifecycle: `contracts/state-machines/AUTH-007-mfa-lifecycle.v1.json` now declares factor and sign-in challenge states, allowed and forbidden transitions, and security invariants. `workers/W02-identity/src/auth/mfa-lifecycle-contract.test.ts` binds key contract invariants to the W02 replay, verification and privileged-session source. The contract remains `CONTRACTED_NOT_VERIFIED`; production transition and end-to-end evidence remain incomplete.
- Secret/protected-factor storage contract: the proposed field contract now requires encrypted TOTP secret and recovery-code storage with no secret exposure; independent implementation and at-rest evidence remain missing.
- Challenge lifecycle requirements are represented in the API contract and W01/W02 adapters, but exact expiry, cross-account, single-use and deployed security E2E behavior has not yet been accepted.
- Replay/attempt-counter persistence mapping: migration 0006 now declares `lastAcceptedTotpTimeStep`; W02 source uses a monotonic conditional D1 update and reserves the exact accepted TOTP time step before Better Auth completes verification. The migration has not been deployed, and same-SHA runtime, concurrency/replay and remote schema read-back evidence remain required before promotion.
- Recovery-code contract: rotate and single-use recovery behavior are defined in the canonical API/field contracts; deployed rotation, reuse rejection and recovery-specific security E2E evidence remain incomplete.
- Step-up/session assurance result contract: missing.
- MFA permission/scope IDs `user.mfa.read` and `user.mfa.manage` are registered as self-scoped permissions; operation-level proof and production authorization evidence remain incomplete.
- All ten MFA audit event names are registered in `contracts/events/domain-completion.v1.json` and bound to AUTH-007 operations. W02 source now emits the three enrollment events from the enrollment handlers and the remaining seven from Better Auth request lifecycle hooks: challenge success/failure, factor disable, recovery-code rotation/consumption, lockout (deduplicated by lockout window), and persisted TOTP replay rejection. The source uses the W02 D1-01 `auth_007_mfa_publication_journal`; a scheduled publisher reuses the existing `AUTH013_QUEUE`, and W06 dispatches validated MFA events to the existing immutable D1-03 `audit_events` writer with event-ID deduplication. Both `auth_013_publication_journal` and `auth_007_mfa_publication_journal` are explicitly registered as W02-owned, cross-Worker-read-restricted tables in `contracts/transport/logical-data-authority.v1.json`. The controlled migration workflow runs an executable local SQLite migration audit before protected rollout admission and plans remote table/index/migration-ledger read-back. Focused tests cover event outcome classification, deterministic lockout deduplication, actor/target checks, secret-field rejection, duplicate delivery and persistence failure. This is source implementation/test evidence only: migration 0008 has not been applied remotely, and deployed W02/W06 queue delivery, DLQ behavior, schema read-back, positive/negative security E2E and current-head Evidence Registry acceptance remain missing.
- Account-state enforcement mapping: incomplete.
- Authoritative D1 persistence/table/column evidence: unresolved.
- W01/Payload route adapters and route-level integration tests are present; deployed cross-Worker runtime evidence is still missing.
- Executable W01/W02 implementation and local test evidence are present; deployed-source and remote D1 read-back evidence are still missing.
- Positive and negative security E2E evidence: missing.
- W01 route-level integration tests and W02 handler/unit tests are present; live W01↔W02 integration evidence is still missing.
- Evidence Registry IDs: missing.



## 2A. Field-contract progress (2026-10-24)

- Added `contracts/entity/AUTH-007-mfa-factor-field-contract.v1.json` as `CONTRACTED_NOT_VERIFIED`; registered `ENT-MFA-FACTOR` as `PROPOSED` and added proposed fields to the entity field catalog.
- Added an implementation-evidence row that explicitly remains `BLOCKED`; source code and migration presence are not admitted production evidence.
- The contract identifies `lastAcceptedTotpTimeStep` as a required replay-prevention field; it now exists in the source migration and is consumed by the W02 source guard. Production deployment/read-back and accepted security evidence remain absent. No MFA deployment or L8 grant is authorized by this progress update.
- `AUTH-007` remains `BLOCKED_NOT_GREEN` and Implementation authorization remains `false`.



## 2B. Public API contract proposal (2026-10-24)

- Added `contracts/api/AUTH-007-mfa-totp-contract.v1.json` defining the W01 public MFA enrollment/status/confirmation/challenge/disable/recovery-code operations. W01 remains the only APP/H5/PC public API entry; W02 remains the factor/identity/D1-01 authority.
- The proposed contract explicitly requires an atomic persisted TOTP time-step replay guard, identity-bound single-use challenges, recovery-code single-use/rotation, account/factor lockout, no-store responses, step-up for factor disable/recovery rotation, session invalidation on enable/disable, and audit event coverage.
- The six operation IDs and login HTTP 202 challenge variant are mapped in `contracts/openapi/v1/openapi.yaml`; DTO records, auth operation policy, OpenAPI operation policy, self-scoped permissions and endpoint inventory are bound. W01 adapters and route-level tests cover status, enrollment start/confirm, challenge verification, disable and recovery rotation. W02 tests cover authoritative status, pending-factor/idempotency guards, verified confirmation, account-state checks, atomic/concurrent TOTP replay rejection and the new lifecycle contract. Operation-policy `state` evidence is now marked `PASS` only for the local lifecycle slices with source tests; resource-budget and anti-abuse dimensions now have explicit bounded policies and local test coverage; production security E2E remains missing. Production security E2E, controlled D1-01 migration/read-back, audit-event/Evidence Registry admission and final Mapping 0 validation remain outstanding. This progress does not authorize production deployment or the L8 grant.
- `AUTH-007` remains `BLOCKED_NOT_GREEN`; implementation authorization remains `false`.


## 2C. Production MFA security E2E evidence (2026-10-25)

- Protected live workflow: https://github.com/wanghuinet/luckread/actions/runs/40157067122
- Tested source SHA: `afae8f8947a4b2b7aa3358c5f359eb7577ba7b31`; job `121060602451`; sanitized evidence artifact: https://github.com/wanghuinet/luckread/actions/runs/40157067122/artifacts/12585720278
- Result: **25/25 assertions passed; 0 failed**. The artifact confirms enrollment and authoritative read-back, invalid-code rejection without mutation, login challenge and successful TOTP, consumed-challenge rejection, same-step TOTP replay rejection, recovery-code success and reuse rejection on a fresh challenge, MFA disable with password + fresh TOTP, prior-session revocation, and post-disable read-back/login. It records no passwords, TOTP secrets/codes, recovery codes, cookies, session tokens, user identifiers or response bodies.
- Evidence Registry record `EVD-AUTH007-MFA-LIVE-SECURITY-E2E-20261025-001` is added with result `PASS` and status `CREATED`. It is pending formal admission; it is not represented as `VERIFIED`.
- This addendum supersedes earlier statements that *no live MFA end-to-end run exists* only for the scenarios enumerated above. It does **not** establish complete AUTH-007 closure. Still outstanding: challenge-expiry testing; cross-account authorization negatives; bounded-attempt/rate-limit/lockout evidence; production W02 outbox → existing `AUTH013_QUEUE` → W06 canonical AuditEvent persistence, duplicate delivery and DLQ/failure evidence; canonical entity/field admission; current-head Evidence Registry acceptance and final Mapping 0 validation.
- Consequently, this run does not change the top-level status: `AUTH-007 = BLOCKED_NOT_GREEN`, implementation authorization `false`, and no L8 grant is allowed.

## 3. Security interpretation rules

No factor type, endpoint, entity, secret field, recovery mechanism, challenge algorithm, attempt limit, or persistence location is promoted to canonical design merely because MFA is named in the Blueprint or referenced by security documents.

The existing security documents establish requirements and boundaries, not an implemented MFA protocol. In particular, the repository does not currently provide evidence that a factor secret is stored safely, that challenge consumption is single-use, that replay is rejected, or that recovery cannot bypass the identity security model.

## 4. Mandatory security gate

Before MFA can become GREEN, the canonical contract must explicitly define at least:

- factor enrollment bound to the authenticated identity;
- protected handling of factor secret/material;
- challenge issuance and expiration;
- bounded failed-attempt behavior;
- single-use/replay resistance;
- account-state checks before enrollment, challenge and verification;
- step-up assurance semantics for privileged/sensitive operations;
- secure disable/re-enrollment flow;
- recovery path with explicit identity-proof requirements;
- audit events for success, failure, enrollment, disable and recovery;
- no account-enumeration leakage;
- no sensitive factor material in logs, DTOs, cache or public responses.

These requirements align with the repository's deny-by-default authorization, security-center step-up, replay and brute-force controls. fileciteturn277file0L1-L3 fileciteturn273file0L1-L3

## 5. Closure criteria

`AUTH-007` may be promoted only when:

- MFA API and DTO contracts are frozen and registered;
- factor entity and fields are authoritative and classified;
- challenge, factor and recovery state machines are explicit;
- permission/scope and L5-L8 step-up bindings are mapped;
- migration/schema evidence proves authoritative persistence;
- implementation passes deterministic validation and secret-handling review;
- security tests prove invalid, expired, replayed, cross-account and excessive-attempt requests fail closed;
- recovery and disable flows cannot bypass identity/account-state controls;
- integration tests have real execution evidence;
- Evidence Registry references are non-empty and bound to `AUTH-007`;
- final Mapping 0 validation is tied to the resulting commit SHA.

## 6. Gate result

`AUTH-007 = BLOCKED_NOT_GREEN`

No runtime MFA implementation is authorized by this reconciliation record. The feature remains blocked until the canonical contract and complete evidence chain exist.
