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

The current AUTH-013 B01 record now binds the existing canonical `transitionAccountState` operation. The separately inventoried `postAccountsAccountIdSuspend` and `postAccountsAccountIdRestore` operations remain Discovery Drafts, and no separate canonical freeze/ban operation is established by inference.

Therefore `transitionAccountState` is the only currently bound canonical account-state operation for AUTH-013; freeze/ban-specific endpoint semantics may not be inferred from Discovery Draft route names.

The API inventory requires each endpoint to bind schema, OpenAPI operation ID, permission, scope, state machine, cache policy, resource/retry/event/queue budgets, anti-abuse, idempotency, mapping, examples, and integration/security evidence before GREEN.

## 5. Permission evidence

The B01 capability record explicitly references:

- `user.restrict.limited`
- `user.freeze`
- `user.suspend`
- `user.ban`

The state machine additionally references `user.unfreeze`, `user.reinstate`, and `user.restore` for reverse/repair paths.

The existence of these IDs is confirmed at contract level; current executable enforcement and test evidence are not established.

## 6. Critical ownership boundaries

### 6.1 D1 domain naming conflict — RESOLVED

The B01 AUTH-013 record currently declares:

`d1Domain = D01 Core`.

The logical domain naming decision is now reconciled to `D01 Core` under Change Control; this does not constitute physical D1 schema or runtime evidence.

### 6.2 Worker ownership conflict

`contracts/enums/account-state.json` currently declares `authoritative-writer: W00`.

The current canonical Worker Master explicitly makes W00 historical/non-current and assigns Identity / Account / Authorization to **W02 / D1-01**. Therefore `W00` cannot be promoted as current runtime ownership by inference.

The Worker ownership decision is now reconciled to W02 / D1-01. The remaining blockers are DTO, physical persistence, runtime and executable evidence.

## 7. Entity / field / persistence evidence

### 7.1 Deterministic entity binding

The account state machine names its entity as `User`, and the canonical entity catalog contains exactly one VERIFIED `User` entity: `ENT-USER`. Therefore the Feature → Entity mapping for AUTH-013 is deterministically reconciled to `ENT-USER`.

The canonical Field IDs are now admitted for the existing `ENT-USER` Entity: `ENT-USER-F-ACCOUNT-STATE` and `ENT-USER-F-ACCOUNT-STATE-VERSION`. They remain `CONTRACTED_NOT_VERIFIED` until physical schema/runtime evidence is captured.



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

1. D1-01 versus D01 Core naming conflict — RESOLVED under Change Control; do not infer physical D1 schema.
2. W02 / D1-01 authoritative-writer decision — RESOLVED by `CC-MAPPING-0-AUTH-013-AUTHORITY-2026-09-23`.
3. Canonical `account_state` / `account_state_version` Field IDs — ADMITTED by `CC-MAPPING-0-AUTH-013-FIELD-ADMISSION-2026-09-23`.
4. Keep the canonical `transitionAccountState` binding explicit; any separate suspend/restore/freeze/ban operation requires its own approved Contract admission before binding.
5. DTO binding — ADMITTED by `CC-MAPPING-0-AUTH-013-DTO-ADMISSION-2026-09-23`.
6. Bind state, event, audit, cache, and security IDs.
7. Establish authoritative D1 persistence and migration evidence; current target is `users`, while physical target columns remain uncreated.
8. Resolve the explicit existing-user state/version backfill decision before migration execution.
9. Implement and verify the full state-transition side-effect chain only after Contract authorization.
10. Execute complete positive/negative/security/integration tests and populate non-empty Evidence Registry entries.
11. AUTH-013 remains non-green until all remaining persistence/backfill/runtime/evidence gates pass.


## Current evidence reconciliation — 2026-09-23

The following downstream evidence is now independently verified and is inherited without re-execution:

- W02 physical deployment: GitHub Actions Run `35816952574`, source `0c0c250f1f2ec6da38a8b3c50834d74a4999f5da`, Cloudflare Worker `luckread-w02`, version `7eb5d373-14b3-4354-9d72-af72c1a0a6cc`.
- RoleAssignment D1-01 remote migration/readback: previously captured controlled evidence remains valid for the tested migration/source scope.
- W01 → W02 `W02_AUTH` Service Binding: Run `35819898556`, source `d64d7527564239a487a6e0ad6dceb1b5e8dac3b9`, Cloudflare W01 version `3e6e2646-1979-488b-b273-72e84a582878`; deployment output explicitly reports `env.W02_AUTH (luckread-w02) -> Worker`.

These facts close the previously open physical Worker/binding evidence items for the E6 downstream path, but they do not resolve the remaining AUTH-013 Contract authority inputs. The W00 writer conflict and canonical Field-ID decision inputs are now resolved. The persistence target is now contracted to the existing D1-01 `users` table, and the DTO binding is admitted. The captured remote pre-schema evidence shows that `account_state` and `account_state_version` are not yet present. No runtime promotion is made by this reconciliation.

Current AUTH-013 disposition remains: **BLOCKED_NOT_GREEN / implementation authorization=false**.


## 2026-09-23 persistence/DTO gate evidence

- D1-01 physical target table: `users` — observed in controlled remote schema evidence from workflow run `35657959095`.
- Observed pre-schema columns: `id`, `updated_at`, `created_at`, `email`, `reset_password_token`, `reset_password_expiration`, `salt`, `hash`, `login_attempts`, `lock_until`.
- `account_state` and `account_state_version` were **not present** in that captured snapshot.
- Target physical columns are therefore migration targets, not current remote evidence.
- Canonical DTOs are now bound to the existing OpenAPI schemas under `transitionAccountState`.
- A new read-only current-head workflow `.github/workflows/auth-013-persistence-schema-evidence.yml` captures D1 metadata, users schema/indexes, user-row count, target-column presence, and migration history with exact `GITHUB_SHA` provenance.

## Explicit migration blocker

The existing-user backfill semantics are intentionally **deferred under Decision C**. The Account State Machine defines lifecycle states and transitions but does not authorize an initial `account_state` or `account_state_version` for pre-existing rows. No migration execution is authorized until an authoritative, complete, deterministic classification source/policy is admitted.


## 2026-09-23 backfill decision closure

Decision `CC-MAPPING-0-AUTH-013-BACKFILL-DECISION-2026-09-23` selects **C**: do not invent initial lifecycle state/version for existing Users. Current repository evidence does not establish a complete authoritative source from which those values can be safely derived. This is now a recorded data-semantic gate, not an unresolved question to be rediscovered.
