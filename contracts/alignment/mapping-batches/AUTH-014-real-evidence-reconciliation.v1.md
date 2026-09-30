# AUTH-014 Real-Evidence Reconciliation v1.0

- Feature: `AUTH-014`
- Name: account recovery
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Evidence mode: repository-grounded, fail-closed
- Scope: Mapping-0 / B01 Identity-Auth-Account

## 1. Canonical feature definition

B01 defines `AUTH-014` as **account recovery** with the following frozen hierarchy:

- L1: Identity / Auth / Account
- L2: Recovery
- L3: Account recovery
- L4: Recover access
- L5: Recover an account
- L6: Validate a time-bounded recovery challenge and restore permitted access
- L7: Recovery must be single-use, time-bounded, identity-bound and must not bypass account enforcement policy

The repository's feature inventory also records `AUTH-014` as discovered from the canonical feature blueprint. No implementation capability is implied by discovery alone.

## 2. Authoritative source contracts

The current B01 record declares the following authoritative sources for this feature family:

1. `contracts/api/auth-operation-policy.v1.json`
2. `contracts/api/api-inventory.v1.json`
3. `contracts/state-machines/account.json`
4. `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
5. `contracts/entity/entity-catalog.v1.json`
6. `contracts/entity/entity-field-contract.v1.json`
7. `contracts/alignment/database-entity-persistence-inventory.v1.json`
8. canonical Worker/D1 mapping contracts
9. repository tests and Evidence Registry

B01 itself remains `NOT_GREEN` and requires complete bidirectional traceability across page, API, DTO, data, security, entitlement, state, event, worker, D1, tests and evidence. fileciteturn660file0

## 3. API reconciliation

The API inventory contains the route:

- `POST /v1/account/recovery`

The identity implementation plan also contains password recovery routes:

- `POST /v1/auth/password/forgot`
- `POST /v1/auth/password/reset`

These route strings are **not** treated as canonical operation IDs without an explicit binding in the API contract. The current AUTH-014 B01 record has:

- `apiRefs: []`
- `dtoRefs: []`
- `dataRefs: []`
- `permissionRefs: []`
- `entitlementRefs: []`
- `stateRefs: ["account"]`
- `eventRefs: []`
- `workerRefs: []`
- `testRefs: []`
- `evidenceRefs: []`
- `d1Domain: UNRESOLVED`
- `reconciliationState: PARTIAL`

Therefore the existence of the route is evidence of an inventory entry, not evidence of a bound, implemented, tested recovery operation. fileciteturn673file0

## 4. Recovery execution units

The identity/session registry defines the minimum validation units for password recovery:

- `verify-current-credential-01`
- `password-reset-request-01`
- `password-reset-token-01`
- `validate-reset-token-01`
- `consume-reset-token-01`
- `replace-password-hash-01`
- `revoke-compromised-credential-01`
- `security-event-record-01`

The stated minimum claims include:

- recovery requests create a durable operation/token boundary and do not reveal account existence;
- reset tokens expire, are stored safely, and raw tokens are not logged;
- a reset token can be consumed only once, with concurrency unable to cause a double reset;
- the new password hash verifies while the old credential becomes invalid and secret material is absent from telemetry;
- compromised credentials become unusable and session behavior follows policy;
- security events preserve required correlation without exposing sensitive credential material. fileciteturn665file0 fileciteturn667file0

These are contract/test claims, not execution evidence.

## 5. Entity and field reconciliation

Current entity-field evidence shows:

- `ENT-CREDENTIAL` = `PROPOSED`, fields = `[]`
- `ENT-SESSION` = `PROPOSED`, fields = `[]`
- `ENT-VERIFICATION` = `PROPOSED`, fields = `[]`

The persistence inventory records `ENT-USER` as `VERIFIED`, but its persistence itself is not yet verified. The existing Payload Users collection is therefore insufficient to prove that recovery-specific credential/token/session state exists under the canonical contracts. fileciteturn676file0

Required Mapping-0 closure still needs authoritative IDs for at least:

- recovery operation/request
- recovery token/challenge
- credential/replacement state
- any session revocation or credential version state used by recovery
- security/audit event data
- all fields participating in single-use, expiry, identity binding, purpose binding and replay protection

No such IDs are invented in this reconciliation.

## 6. Runtime/code evidence audit

A repository search for concrete recovery implementation terms did not return a verified password-reset/recovery handler, recovery token service, credential replacement service, or equivalent execution path.

Existing evidence therefore does **not** establish:

- request creation and durable token boundary;
- enumeration-safe response behavior;
- secure token generation/storage;
- token expiry enforcement;
- purpose and identity binding;
- atomic/single-use token consumption;
- password hash replacement;
- invalidation of the prior credential;
- compromised credential/session revocation;
- security event emission;
- recovery behavior against restricted/frozen/suspended/banned account states.

The current `Users` collection is an authenticated Payload collection with basic user fields and client-writable-field protection, but it does not provide evidence for the complete recovery contract. No password recovery implementation is inferred from Payload internals or route names.

## 7. Worker and D1 reconciliation

The canonical Worker Master assigns Identity / Account / Authorization to `W02`, while the Worker Binding Mapping explicitly forbids inferring Worker/D1 ownership from code, routes, collections, directory names, runtime bindings or historical documents. Therefore this reconciliation does not silently assign AUTH-014 to a Worker or D1 domain merely because W02 is the current identity worker boundary. fileciteturn678file0 fileciteturn678file1

The current B01 record keeps AUTH-014 D1 mapping unresolved. This is correct until the frozen Worker/D1 mapping and feature-level data authority are explicitly bound.

## 8. Account-state safety reconciliation

The account state machine is authoritative for account lifecycle. Recovery must not bypass enforcement policy. In particular, recovery must not silently convert a forbidden or terminal state into an active account state merely because a token is valid.

Required closure evidence must demonstrate:

1. account state is checked before recovery completion;
2. forbidden transitions remain forbidden;
3. token validity does not override suspension/ban/deletion policy;
4. recovery-side session/token invalidation follows the existing lifecycle/security contracts;
5. lifecycle/security audit records capture the actor, resource, action and correlation without secret material.

The recovery feature therefore depends on the existing account state machine rather than creating a parallel recovery state authority.

## 9. Security invariants to prove

Before GREEN, the following must be executable and evidenced:

- account enumeration resistance for recovery requests;
- constant/policy-safe error semantics where required;
- strict rate limiting and anti-abuse boundary;
- token entropy and secure storage with no raw-token telemetry;
- single-purpose token binding;
- identity binding and expiry enforcement;
- atomic consume/mark-used behavior under concurrency;
- replay rejection;
- no cross-account recovery;
- no authorization/state-machine bypass;
- no credential or reset secret leakage;
- old credential invalidation after successful reset;
- session handling consistent with the token/session strategy;
- security event correlation and immutable audit expectations where required.

These are closure requirements, not claims that they are currently implemented.

## 10. Tests and evidence

Current AUTH-014 record has empty test/evidence references. The registry validation units above provide the required test surface, but there is no repository evidence tying successful execution to a commit SHA.

Minimum GREEN evidence package:

- unit evidence for request validation, token issuance, token validation and token consumption;
- concurrency test proving exactly one successful consume/reset;
- security test proving no account enumeration;
- credential replacement test proving old credential rejection and new credential acceptance;
- session/token revocation test according to policy;
- account-state boundary tests for restricted/frozen/suspended/banned/deletion states;
- integration E2E for request -> challenge -> validate -> consume -> credential replacement -> session/security effects;
- CI execution result tied to the exact commit SHA;
- non-empty canonical Evidence Registry entries consumed by the Mapping-0 validator.

## 11. Current mapping matrix

| Dimension | Current state | GREEN requirement |
|---|---|---|
| Feature | VERIFIED at blueprint/inventory level | stable canonical feature ID |
| Capability | PARTIAL | explicit capability binding |
| API | PARTIAL | canonical operation ID + route + schema + OpenAPI |
| DTO | MISSING | request/response/error DTO IDs |
| Entity | MISSING/PARTIAL | credential/recovery/session entities explicitly bound |
| Field | MISSING | field IDs for all authoritative data |
| Permission | MISSING | canonical permission IDs and scope |
| Entitlement | MISSING | explicit entitlement decision or documented not-applicable proof |
| State | PARTIAL | account state + recovery transition semantics fully bound |
| Event | MISSING | canonical recovery/security lifecycle events |
| Worker | UNRESOLVED | explicit feature-to-worker binding under frozen Worker Master |
| D1 | UNRESOLVED | explicit domain/data authority binding |
| Tests | MISSING | executable tests mapped to registry units |
| Evidence | MISSING | non-empty registry + commit-tied CI evidence |

## 12. GREEN decision

**Decision: BLOCKED_NOT_GREEN.**

AUTH-014 is not authorized for implementation under Mapping-0 because the repository demonstrates contract inventory and validation-unit intent, but does not demonstrate the complete Feature -> Capability -> API -> DTO -> Entity -> Field/Persistence -> Payload -> Code/Worker -> Security -> Lifecycle -> Test -> Evidence chain.

No canonical operation ID, DTO ID, recovery entity/field set, permission set, event set, Worker/D1 binding, runtime handler evidence, executable test evidence or Evidence Registry execution proof is invented or assumed here.

## 13. Closure criteria

AUTH-014 can move toward GREEN only when all of the following are true:

1. API operation IDs are explicitly bound to the frozen route/contract surface.
2. Request/response/error DTOs are canonical and schema-validated.
3. Recovery/token/credential/session data entities and fields are canonical and persisted under the D1/Payload compatibility rules.
4. Permission, scope, account-state and entitlement semantics are explicit.
5. Recovery events and audit semantics are registered.
6. Worker/D1 ownership is explicitly reconciled rather than inferred.
7. Runtime implementation is present and traceable to the contracts.
8. Single-use, expiry, identity binding, replay, enumeration resistance and concurrency invariants pass tests.
9. Integration/security E2E passes in CI.
10. Evidence Registry is non-empty and the Mapping-0 validator consumes it fail-closed.
11. The final validator result is tied to the exact commit SHA.

Until those conditions are met, the feature remains `BLOCKED_NOT_GREEN` and B01 remains `NOT_GREEN`.

## 14. Evidence references

- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- `contracts/alignment/feature-inventory.v1.json`
- `contracts/api/api-inventory.v1.json`
- `contracts/api/auth-operation-policy.v1.json`
- `contracts/state-machines/account.json`
- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- `contracts/entity/entity-field-contract.v1.json`
- `contracts/alignment/database-entity-persistence-inventory.v1.json`
- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- `docs/batches/01-FOUNDATION-IDENTITY-IMPLEMENTATION-PLAN-v1.0.md`
