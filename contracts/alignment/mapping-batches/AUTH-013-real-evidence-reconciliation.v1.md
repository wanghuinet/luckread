# AUTH-013 Real Evidence Reconciliation v1.0

- Feature: `AUTH-013`
- Name: account freeze/suspension/ban
- Audit baseline: `3fd3f49dbae2c4415314be134120b21e55810e07`
- Reconciliation status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability authority: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- State authority: `contracts/state-machines/account.json`
- Lifecycle authority: `docs/303-IDENTITY-ROLE-ENTITLEMENT-SEPARATION-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Worker authority: `docs/04-WORKER-MASTER-v1.0.md`
- API authority: `contracts/api/api-inventory.v1.json`

## 1. Canonical feature scope

AUTH-013 is frozen as:

`Identity / Auth / Account` → `Account lifecycle` → `Account enforcement` → `Freeze/suspend/ban` → `Restrict account access` → `Apply an authorized account-state transition`.

The B01 capability contract requires that only valid account-state transitions are permitted and that protected mutations and sessions respect enforced states.

## 2. Confirmed canonical state-machine evidence

`contracts/state-machines/account.json` defines the authoritative User account state machine in D01 Core with:

- state field: `account_state`
- version field: `account_state_version`
- audit required: `true`
- event: `identity.account_state_changed`
- `ACTIVE → RESTRICTED` via `user.restrict.limited`
- `ACTIVE → FROZEN` via `user.freeze`
- `ACTIVE → SUSPENDED` via `user.suspend`
- `ACTIVE → BANNED` via `user.ban` with approval required
- corresponding escalation transitions from `RESTRICTED` and `FROZEN`
- `SUSPENDED → ACTIVE` via `user.reinstate`
- `BANNED → RESTORED` via `user.restore` with L7 approval
- forbidden direct `BANNED → ACTIVE` and `DELETED → ACTIVE`
- token invalidation states include `SUSPENDED`, `BANNED`, `DELETION_PENDING`, `DELETED`
- deindex states include `FROZEN`, `SUSPENDED`, `BANNED`, `DELETION_PENDING`, `DELETED`

The state enum independently lists the same 12 lifecycle states, including `FROZEN`, `SUSPENDED`, `BANNED`, `DELETED`, `RESTORED`, and `REACTIVATED`.

## 3. Confirmed lifecycle/security side effects

`docs/303` requires every account-state transition to record:

- `actor_id` and `actor_type`
- required permission
- precondition result
- side effects
- `identity.account_state_changed`
- W06 audit with before/after state
- incremented `account_state_version`
- token handling according to the state

The documented side-effect matrix states, among other requirements:

- `RESTRICTED`: retain token/session; restrict protected writes
- `FROZEN`: retain token/session; hide content/comments and remove from feed/search
- `SUSPENDED`: invalidate tokens and terminate sessions; hide content/comments; stop notifications; remove from feed/search
- `BANNED`: invalidate tokens and terminate sessions; hide/stop distributing content; stop notifications; remove from feed/search
- `DELETION_PENDING` / `DELETED`: invalidate access and follow deletion/retention rules
- `RESTORED` / `REACTIVATED`: require re-login and controlled restoration/re-indexing

These are contract requirements, not runtime proof.

## 4. API mapping evidence

`contracts/api/api-inventory.v1.json` contains the account endpoint groups:

- `GET /v1/accounts/{accountId}`
- `PATCH /v1/accounts/{accountId}`
- `POST /v1/accounts/{accountId}/suspend`
- `POST /v1/accounts/{accountId}/restore`

However, the current AUTH-013 B01 record has `apiRefs: []`. No canonical operation IDs are currently bound to AUTH-013, and no canonical operation is explicitly established for `freeze` or `ban` in the API inventory.

Therefore no endpoint may be inferred as the canonical freeze/ban implementation merely from route naming.

The API inventory requires each endpoint to bind schema, OpenAPI operation ID, permission, scope, state machine, cache policy, resource/retry/event/queue budgets, anti-abuse, idempotency, mapping, examples, and integration/security evidence before GREEN.

## 5. Permission evidence

The B01 capability record explicitly references:

- `user.restrict.limited`
- `user.freeze`
- `user.suspend`
- `user.ban`

The state machine additionally references `user.unfreeze`, `user.reinstate`, and `user.restore` for reverse/repair paths.

The existence of these IDs is confirmed at contract level; current executable enforcement and test evidence are not established.

## 6. Critical ownership conflicts

### 6.1 D1 domain naming conflict

The B01 AUTH-013 record currently declares:

`d1Domain = D01 Core`.

The logical domain naming decision is now reconciled to `D01 Core` under Change Control; this does not constitute physical D1 schema or runtime evidence.

### 6.2 Worker ownership conflict

`contracts/enums/account-state.json` currently declares `authoritative-writer: W00`.

The current canonical Worker Master explicitly makes W00 historical/non-current and assigns Identity / Account / Authorization to **W02 / D1-01**. Therefore `W00` cannot be promoted as current runtime ownership by inference.

This is a second blocking authority conflict and requires formal reconciliation before AUTH-013 can be GREEN.

## 7. Entity / field / persistence evidence

`ENT-USER` is the only currently verified identity entity implementation. The current entity-field contract defines verified User fields only for:

- username
- displayName
- bio
- avatar
- locale
- timezone

No canonical Field IDs are currently defined for `account_state` or `account_state_version` in the entity-field contract.

The remaining identity entities are still proposed/contract-only, and the entity implementation-evidence registry has no verified implementation/persistence evidence for them.

Therefore the following are unresolved and must not be inferred:

- canonical `account_state` field ID
- canonical `account_state_version` field ID
- state-change reason field ID
- actor/reference field IDs
- approval record field ID
- effective-at / expiry field IDs
- concrete D1 table/column names
- Payload-generated table or column names

## 8. Runtime/code evidence

`src/collections/Users.ts` currently defines only the verified public/profile fields and own-user access controls. It does not define `account_state` or `account_state_version`, and no account-state transition implementation is established there.

Repository evidence does not currently establish a concrete authoritative handler/service/Worker implementing:

`request → authorization → state precondition → authoritative state mutation → version increment → event/audit → token/session enforcement → projection/deindex side effects → response`.

No implementation may be inferred from Payload's internal behavior.

## 9. Event / audit / cache evidence

Canonical event requirement:

`identity.account_state_changed`

Canonical cache version requirement:

`account_state_version`

Lifecycle audit is mandatory, including before/after state and actor/resource correlation.

The repository currently has contract-level declarations for these requirements, but no execution evidence proving event emission, immutable audit persistence, deterministic version increments, or complete consumer convergence.

## 10. Required test and Evidence Registry coverage

Before GREEN, executed evidence must cover at minimum:

- valid `ACTIVE → RESTRICTED`
- valid `ACTIVE → FROZEN`
- valid `ACTIVE → SUSPENDED`
- valid `ACTIVE → BANNED` with approval
- escalation from `RESTRICTED` / `FROZEN`
- valid reinstatement/unfreeze/restore paths where applicable
- invalid state transitions return the canonical state error
- missing/insufficient permission is denied
- missing precondition is denied
- unauthorized cross-scope mutation is denied
- approval-required ban cannot bypass approval
- every accepted transition increments `account_state_version`
- event `identity.account_state_changed` is emitted with required metadata
- audit contains before/after and actor/resource correlation
- `SUSPENDED` / `BANNED` immediately invalidate tokens and terminate sessions according to contract
- stale cache cannot override an enforced state
- FROZEN/SUSPENDED/BANNED deindex behavior converges
- repeated/idempotent mutation semantics are deterministic where the API contract requires them
- migration executes successfully against D1
- integration and security E2E execute successfully
- Evidence Registry IDs bind to actual results and commit SHA

## 11. GREEN decision

`AUTH-013 = BLOCKED_NOT_GREEN`.

Implementation authorization remains `false`.

AUTH-013 cannot transition to GREEN until the mapping is complete in both directions:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

and the D1 and Worker authority conflicts have been formally resolved.

## 12. Closure criteria

1. Resolve the `D1-01` versus `D01 Core` naming conflict through the canonical data/Worker mapping.
2. Resolve the stale `W00` authoritative-writer declaration against the current W02 ownership model.
3. Establish canonical `account_state` and `account_state_version` field IDs.
4. Bind canonical API operation IDs for suspend/restore and any explicitly approved freeze/ban operations.
5. Bind DTO, state, event, audit, cache, and security IDs.
6. Establish authoritative D1 persistence and migration evidence without relying on undocumented Payload schema.
7. Implement and verify the full state-transition side-effect chain only after Contract authorization.
8. Execute complete positive/negative/security/integration tests and populate non-empty Evidence Registry entries.
9. Change AUTH-013 from `CONFLICT/PARTIAL` to `GREEN` only after the final Mapping 0 validator passes.
