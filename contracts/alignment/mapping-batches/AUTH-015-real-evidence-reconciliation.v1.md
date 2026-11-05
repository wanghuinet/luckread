# AUTH-015 Real-Evidence Reconciliation v1.0

- Feature: `AUTH-015`
- Name: account deletion and restoration policy
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Evidence mode: repository-grounded, fail-closed
- Scope: Mapping-0 / B01 Identity-Auth-Account

## 1. Canonical feature definition

B01 defines `AUTH-015` as **account deletion/restoration** with this frozen hierarchy:

- L1: Identity / Auth / Account
- L2: Account lifecycle
- L3: Deletion and restoration
- L4: Delete/restore
- L5: Request, cancel or restore account lifecycle
- L6: Execute only valid deletion/restoration state transitions
- L7: Deletion is state-machine controlled; legal hold and retention rules override normal deletion; direct resurrection is forbidden
- L8: Mapped to the existing account state machine and identity registry

The feature inventory records `AUTH-015` as `DISCOVERED`; discovery does not constitute implementation evidence.

## 2. Authoritative contract set

The reconciliation is bounded by the existing contracts and registries, including:

1. `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
2. `contracts/alignment/cross-system-mapping.v1.json`
3. `contracts/alignment/feature-inventory.v1.json`
4. `contracts/api/api-inventory.v1.json`
5. `contracts/state-machines/account.json`
6. `contracts/enums/account-state.json`
7. `contracts/authz/permissions.json`
8. `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
9. `docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
10. `contracts/entity/entity-catalog.v1.json`
11. `contracts/entity/entity-field-contract.v1.json`
12. `contracts/alignment/database-entity-persistence-inventory.v1.json`
13. canonical Worker/D1 binding contracts
14. repository tests and canonical Evidence Registry

B01 remains `NOT_GREEN` and its green rule requires complete bidirectional traceability across page, API, DTO, data, security, entitlement, state, event, Worker, D1, tests and evidence.

## 3. Current Mapping-0 record

The B01 AUTH-015 record currently contains:

- `apiRefs: []`
- `pageRefs: []`
- `dtoRefs: []`
- `dataRefs: []`
- `permissionRefs: ["user.reactivate", "user.restore"]`
- `entitlementRefs: []`
- `stateRefs: ["account"]`
- `eventRefs: ["identity.account_state_changed"]`
- `workerRefs: []`
- `testRefs: []`
- `evidenceRefs: []`
- `d1Domain: D01 Core`
- `reconciliationState: PARTIAL`

The cross-system mapping separately records AUTH-015 as `PARTIAL` with blocker `deletion/restoration contract mapping incomplete`. The logical domain naming conflict is resolved by Change Control to `D01 Core`; the remaining PARTIAL state is retained because deletion/restoration API, persistence, runtime and evidence closure are still incomplete.

## 4. API reconciliation

The current generated API alignment inventory identifies two deletion/restoration candidate operations. Both remain discovery-only:

| Candidate operationId | Method/path | Domain | API inventory state | OpenAPI state |
|---|---|---|---|---|
| `postAccountDeletionRequest` | `POST /v1/account/deletion-request` | `audit_compliance` | `DISCOVERED` | `DISCOVERY_DRAFT`; empty schemaRef; default-only response |
| `postAccountsAccountIdRestore` | `POST /v1/accounts/{accountId}/restore` | `users_accounts` | `DISCOVERED` | `DISCOVERY_DRAFT`; empty schemaRef; default-only response |

Grounding:
- `contracts/alignment/api-inventory.v1.json` records both operation IDs with empty `featureIds` and empty `schemaRef`.
- `contracts/openapi/v1/openapi.yaml` contains matching paths/operation IDs but labels each `DISCOVERY_DRAFT`; each has only a default discovery response.
- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json` still has `AUTH-015.apiRefs = []`.

The operation-policy source separately declares:
- `requestAccountDeletion`, `POST /account/deletion`, status `MISSING`;
- `cancelAccountDeletion`, `POST /account/deletion/cancel`, status `MISSING`.

Those policy entries are required-contract intent, not current OpenAPI operation bindings. They are not the same identifiers or paths as the discovery candidate `postAccountDeletionRequest`. In particular, no cancel-deletion operation is present in the current OpenAPI discovery inventory.

A separate existing operation, `transitionAccountState` (`POST /users/{userId}/account-state`), is `CONTRACTED_PARTIAL` and is mapped to AUTH-013. The account state machine permits the self-actor transition `ACTIVE -> DELETION_REQUESTED`; the current generic state-transition source can therefore express that one state change. This does **not** establish the complete AUTH-015 deletion-request workflow: the dedicated request's reauthentication, durable idempotency, eligibility/legal-hold checks, cooling-off deadline, cancel operation, async progression, and retention/erasure semantics are not thereby implemented or evidenced.

Restoration also has two distinct state-machine concepts that must not be conflated:
- `BANNED -> RESTORED`: privileged admin restoration using `user.restore` and L7 approval;
- `DELETED -> REACTIVATED`: self-reactivation using `user.reactivate` within the bounded reactivation window.

The current `postAccountsAccountIdRestore` discovery draft does not yet specify which of these cases it implements, its authorization/approval semantics, or its request/response schema.

The API inventory requires explicit schema, OpenAPI binding, permission, scope, state-machine, cache, read/write classification, resource budget, RPC/retry/event/queue budgets, anti-abuse, idempotency, mapping, examples, and integration E2E evidence before Contract Green; sensitive/privileged operations also require security E2E evidence.

**Disposition:** no operation is promoted or newly bound to AUTH-015 in this reconciliation. The existing discovery operation IDs are recorded as candidates only; B01 `apiRefs` remains empty until a Change Control decision admits the canonical deletion/cancel/restoration API surface.

## 5. Lifecycle and state-machine reconciliation

`contracts/state-machines/account.json` is the authoritative lifecycle state machine. It defines:

- `ACTIVE -> DELETION_REQUESTED` by user, with no permission field in the current state contract;
- `DELETION_REQUESTED -> DELETION_PENDING` by `system.job`;
- `DELETION_REQUESTED -> ACTIVE` by user when `within_cooling_off`;
- `DELETION_PENDING -> DELETED` by `system.job` when `cooling_off_elapsed`;
- `DELETION_PENDING -> ACTIVE` by user when `within_cooling_off`;
- `DELETED -> REACTIVATED` by user under `user.reactivate` and `within_reactivation_window`;
- `RESTORED -> ACTIVE` by `system.job`;
- `REACTIVATED -> ACTIVE` by `system.job`.

It also defines the protected restoration path:

- `BANNED -> RESTORED` by admin under `user.restore` with L7 approval;
- `BANNED -> ACTIVE` is forbidden;
- `DELETED -> ACTIVE` is forbidden and must pass through `REACTIVATED`;
- any state -> `UNREGISTERED` is forbidden.

The state machine declares `account_state` and `account_state_version`, requires audit, and emits `identity.account_state_changed`. Token invalidation is required for `SUSPENDED`, `BANNED`, `DELETION_PENDING`, and `DELETED`; deindexing is required for `FROZEN`, `SUSPENDED`, `BANNED`, `DELETION_PENDING`, and `DELETED`.

The canonical lifecycle contract additionally defines a default 15-day deletion cooling-off period and a default 30-day reactivation window. It requires actor identity/type, permission, preconditions, side effects, lifecycle event, W06 audit before/after, version increment, token handling, and deletion data semantics for each state transition.

These are contract requirements, not execution evidence.

## 6. Deletion/restoration validation units

The identity/session registry provides the minimum execution/verification surface:

- `account-delete-request-01`
- `deletion-eligibility-01`
- `deletion-enqueue-01`
- `deletion-execution-01`
- `restoration-eligibility-01`
- `account-restoration-01`
- `lifecycle-audit-01`
- `privacy-delete-request-01`
- `retention-evaluation-01`
- `privacy-delete-job-01`
- `privacy-audit-01`

The minimum claims include durable and idempotent deletion requests, legal-hold-aware eligibility, safe queue enqueue, deterministic deletion execution, explicit restoration eligibility, authorized restoration, lifecycle audit, retention-policy evaluation, retryable deletion propagation and immutable privacy audit records.

The registry itself is `INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN`; contract references, test references and executable evidence are still required before PASS.

## 7. Entity, field and persistence reconciliation

Current entity evidence is not sufficient to support the complete deletion/restoration model:

- `ENT-USER` is the only verified identity entity implementation;
- `ENT-IDENTITY`, `ENT-CREDENTIAL`, `ENT-SESSION`, `ENT-VERIFICATION`, and `ENT-DEVICE-RECORD` remain `PROPOSED`;
- the field contract has verified fields only for User profile/preferences and has no canonical field set for the proposed credential/session/verification entities;
- `account_state` and `account_state_version` are required by the lifecycle contract but are not present as canonical verified field IDs in the current field contract;
- deletion-request operation state, eligibility markers, retention/legal-hold linkage and restoration-window fields are not established as canonical field IDs;
- `ENT-USER` persistence is recorded as `NOT_VERIFIED` in the database persistence inventory.

No new entity IDs, field IDs, table names or Payload internal columns are invented by this reconciliation. Proposed entities cannot be promoted to the canonical model without explicit field, persistence, authority and lifecycle evidence.

## 8. Payload/runtime/code evidence

The current Payload `Users` collection is an authenticated collection with basic profile fields and client-writable-field protection. Existing repository evidence does not establish an account deletion/restoration handler, lifecycle service, authoritative deletion job, restoration service, or equivalent complete state-transition execution path.

The current `Users` implementation also does not demonstrate verified `account_state` / `account_state_version` persistence. Its collection-level delete access is disabled, which is not equivalent to implementing the contractual deletion workflow.

Payload internal generated tables/columns are not inferred as application-owned persistence. This reconciliation therefore does not treat Payload internals as evidence for the deletion model.

## 9. Authorization and security reconciliation

The canonical B01 binding explicitly references:

- `user.reactivate`: self-scoped reactivation capability;
- `user.restore`: privileged platform-scoped restoration capability with sensitive/audited semantics.

The state machine uses `system.job` for system-driven lifecycle steps. The current contract does not assign a new deletion-request permission ID, so none is invented here.

Required security proof includes:

- self-only deletion request/cancellation behavior;
- explicit deletion eligibility checks, including legal hold and prohibited active transaction/settlement conditions where required by the lifecycle contract;
- deterministic idempotency for repeated deletion requests and job enqueue;
- no unauthorized restoration;
- L7 approval evidence for banned-account restoration;
- no direct `DELETED -> ACTIVE` resurrection;
- no bypass of deletion cooling-off or reactivation-window checks;
- token/session invalidation at the required lifecycle states;
- audit records without sensitive data leakage;
- concurrency protection so stale state cannot overwrite a newer lifecycle state.

## 10. Worker and D1 reconciliation

The current Worker Master is authoritative for current Worker identity:
- W02 is the sole Identity / Account / Authorization authority for T01-T03 and D1-01 account-state facts.
- W01 is the public API ingress boundary only; it does not acquire account-data ownership.
- W10 executes asynchronous jobs under the authority of the owning Worker/Task and may write only its explicitly assigned D1-03 job/execution/idempotency/retry/DLQ/runtime records.
- W08 owns T04 creator/organization identity relationships and hosts the bounded CASL policy evaluator; it does not perform direct D1 writes or replace the owning Worker's lifecycle/workflow checks.

The historical W08 deletion-job wording is reconciled by `docs/change-control/CC-MAPPING-0-AUTH-015-W08-W10-DELETION-EXECUTION-OWNERSHIP-RECONCILIATION-2026-11-06.md` and the corresponding correction to `docs/306`:
- W08 is limited to T04 creator/organization identity relationships and the bounded CASL evaluator; it does not own deletion job execution.
- W10 is the async execution boundary and may execute jobs only under an explicitly approved owning Worker/Task and Workflow/Job contract. W10 does not become the business owner and its D1-03 writes remain limited to assigned runtime records.
- W02 remains the sole account-state authority and D1-01 writer. Each cross-domain deletion side effect remains with its own authoritative Worker and requires explicit event/Queue, retry, idempotency, audit, and reconciliation contracts.

This resolves the **documentary W08-vs-W10 role contradiction only**. It does not assign AUTH-015 an end-to-end Worker map, approve any new Queue/binding, or prove an executable deletion job. The B01 `workerRefs` remains empty until the feature-specific ownership and transport contracts are admitted.

The Worker Master continues to prohibit deriving Worker/D1 feature ownership from code, routes, collections, or directory names. Therefore AUTH-015 receives no silent Worker assignment from this reconciliation.

The B01 AUTH-015 D1 logical-domain naming conflict is RESOLVED by Change Control: `D01 Core` is canonical for this affected reconciliation surface. This does not by itself prove the physical persistence schema or authorize a new table/database.

The state-machine actor label `system.job` specifies an actor class; it does not select W08 or W10 as the owning Worker.

## 11. Cross-system side effects and data propagation

The lifecycle contract requires deletion/restoration semantics to affect multiple projections and domains. In particular, `DELETION_PENDING` requires token invalidation, session termination, content/comment hiding, subscription renewal stoppage, notification stoppage, and search/feed removal. `DELETED` requires full lifecycle handling according to the retention/deletion contract. Restoration/reactivation requires controlled re-login and restoration/re-indexing behavior.

The L5/L6 registry additionally requires deletion propagation to be retryable and completion-verifiable. Cross-D1 mutation must use explicit event, idempotency, authorization, timeout, retry, audit and reconciliation semantics under the Worker Master rules.

Current repository evidence does not prove that these side effects execute correctly or exactly once.

## 12. Tests and Evidence Registry status

The B01 AUTH-015 record has empty `testRefs` and `evidenceRefs`.

Minimum GREEN evidence must include executable proof for:

1. deletion-request authorization and idempotency;
2. deletion-eligibility and legal-hold/transaction constraints;
3. all valid lifecycle transitions and invalid-transition rejection;
4. deletion cooling-off cancellation;
5. queue enqueue idempotency and authority linkage;
6. deletion job retry safety and completion verification;
7. restoration eligibility and privileged approval;
8. reactivation-window enforcement;
9. token/session invalidation and re-login requirements;
10. `account_state_version` monotonicity and concurrent-write protection;
11. lifecycle audit before/after integrity and redaction;
12. derived content/social/notification/search/feed propagation;
13. end-to-end deletion and restoration flows;
14. security E2E for unauthorized restore, direct resurrection, stale-state replay and cross-account access;
15. non-empty Evidence Registry entries consumed by the Mapping-0 validator;
16. final CI validator result tied to the exact commit SHA.

No test result or CI pass is inferred from the existence of registry rows.

## 13. Mapping matrix

| Dimension | Current state | GREEN requirement |
|---|---|---|
| Feature | VERIFIED at blueprint/inventory level | stable canonical `AUTH-015` |
| Capability | PARTIAL | explicit capability binding |
| API | MISSING/PARTIAL | canonical operation IDs, schemas and OpenAPI binding |
| DTO | MISSING | request/response/error DTO IDs |
| Entity | MISSING/PARTIAL | deletion/restoration state entities explicitly bound |
| Field | MISSING | verified IDs for state/version/operation/retention data |
| Permission | PARTIAL | complete self/admin/system scope semantics + evidence |
| Entitlement | MISSING | explicit not-applicable proof or canonical entitlement mapping |
| State | PARTIAL | executable transition + precondition + side-effect mapping |
| Event | PARTIAL | canonical event set + consumers + evidence |
| Worker | UNRESOLVED | approved Worker feature binding |
| D1 | RECONCILED | D01 Core logical-domain naming authority is resolved; physical schema/Worker evidence remains separate |
| Payload/Persistence | MISSING | explicit supported persistence + migration evidence |
| Tests | MISSING | registry-linked executable tests |
| Evidence | MISSING | non-empty Evidence Registry + commit-tied CI result |

## 14. GREEN decision

**Decision: BLOCKED_NOT_GREEN.**

AUTH-015 is not authorized for implementation. The repository proves that deletion/restoration is a canonical lifecycle capability and that the lifecycle registry defines detailed validation units, but it does not prove the complete Feature -> Capability -> API -> DTO -> Entity -> Field/Persistence -> Payload -> Code/Worker -> Security -> Lifecycle -> Test -> Evidence chain.

The most material blockers are:

- no canonical AUTH-015 API operation bindings (the two current OpenAPI candidates remain discovery-only; request/cancel policy operations remain MISSING);
- no deletion/restoration DTO contract IDs;
- no verified canonical deletion/restoration entities and fields;
- no verified `account_state` / `account_state_version` field implementation;
- no explicit Worker feature binding and an unresolved W08-vs-W10 deletion-job ownership conflict;
- no runtime deletion/restoration implementation evidence;
- no executable lifecycle/security E2E evidence;
- empty Evidence Registry linkage.

No missing identifier or implementation is invented to force GREEN.

## 15. Closure criteria

AUTH-015 can advance only when:

1. API operation IDs are explicitly bound to the frozen deletion/restoration routes and schemas.
2. DTO request/response/error contracts are canonical and validated.
3. Lifecycle/deletion operation data entities and all authoritative fields are canonical, persisted and migration-evidenced.
4. Account state/version persistence is explicit and executable.
5. Authorization, scope, eligibility, legal hold, retention and approval rules are explicit.
6. Event and audit IDs are registered and traceable.
7. Worker and D1 ownership are explicitly reconciled under the frozen 12-Worker/4-D1 topology.
8. Runtime implementation is traceable to the contracts.
9. Concurrency, idempotency, cooling-off, restoration-window and forbidden-transition tests pass.
10. Cross-system propagation, retry and completion semantics pass integration/security E2E.
11. Evidence Registry is non-empty and the Mapping-0 validator consumes it fail-closed.
12. Final validator/CI evidence is tied to the exact commit SHA.

Until all conditions are met, AUTH-015 remains `BLOCKED_NOT_GREEN`, B01 remains `NOT_GREEN`, and implementation remains unauthorized.

## 16. Evidence references

- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`
- `contracts/alignment/feature-inventory.v1.json`
- `contracts/api/api-inventory.v1.json`
- `contracts/alignment/api-inventory.v1.json`
- `contracts/api/user-account-operation-policy.v1.json`
- `contracts/openapi/v1/openapi.yaml`
- `contracts/state-machines/account.json`
- `contracts/enums/account-state.json`
- `contracts/authz/permissions.json`
- `contracts/entity/entity-catalog.v1.json`
- `contracts/entity/entity-field-contract.v1.json`
- `contracts/alignment/database-entity-persistence-inventory.v1.json`
- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- `docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- `docs/batches/01-FOUNDATION-IDENTITY-IMPLEMENTATION-PLAN-v1.0.md`


## 17. 2026-11-06 discovery-evidence update

This update records current-head discovery facts only. It does not modify:
- `implementationAuthorized: false`;
- B01 `apiRefs`, `workerRefs`, `testRefs`, or `evidenceRefs`;
- the AUTH-015 `PARTIAL` mapping status;
- API/DTO/entity/field/persistence contracts;
- any Worker, D1, Queue, binding, or runtime source.

The required next decision is to reconcile the W08/W10 execution-owner contradiction and formally admit the canonical deletion/request/cancel/restoration API and data model before implementation. No feature implementation is authorized by this evidence update.
