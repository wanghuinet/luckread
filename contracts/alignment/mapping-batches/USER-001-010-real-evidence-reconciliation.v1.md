# USER-001 to USER-010 Real Evidence Reconciliation v1.0

- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Canonical mapping: `contracts/alignment/cross-system-mapping.v1.json`
- Mapping bridge: `contracts/alignment/mapping-batches/B01-B03-identity-user-authz-org.v1.json`
- Evidence policy: fail-closed; no inference

## 1. USER-001 — Profile

Canonical feature inventory status is `UNRESOLVED`; current mapping has no API/entity/payload/code evidence. Repository inspection found a user-account operation policy that defines `getMe` (`GET /users/me`) and `updateMe` (`PATCH /users/me`) as `CONTRACTED_PARTIAL`, with self scope and explicit mass-assignment/security constraints. However, these operation-policy records are not yet bound into the canonical USER-001 mapping, and required cache, anti-abuse, integration and security-E2E evidence remains missing.

The verified `ENT-USER` entity exists, implemented by `src/collections/Users.ts`, with verified username, displayName, bio, avatar, locale and timezone fields. This is useful evidence for the account/profile substrate but does not prove the complete USER-001 contract.

Missing closure: canonical API→DTO→entity→field→persistence→Payload→code→security→lifecycle→test→Evidence Registry edges.

Gate: `BLOCKED_NOT_GREEN`.

## 2. USER-002 — Avatar / Banner / Bio / Display Name

`ENT-USER` currently provides verified `displayName`, `bio`, and `avatar` fields. No verified canonical banner field was found. The current Payload collection exposes these fields and protects updates with a client-writable-field policy, but there is no complete feature-level API/DTO/persistence/test evidence chain.

Missing closure: banner authority, DTO projection/update contract, field exposure rules, persistence migration evidence, cache invalidation, integration/security tests and Evidence Registry binding.

Gate: `BLOCKED_NOT_GREEN`.

## 3. USER-003 — Locale / Language / Timezone

`ENT-USER` has verified `locale` and `timezone` fields with defaults `en-US` and `UTC`. The field contract marks them as preference-classified, but migration evidence remains pending. No authoritative canonical language field was found.

Missing closure: language field authority, profile/preference API mapping, DTOs, persistence evidence, localization lifecycle, security/test evidence and Evidence Registry binding.

Gate: `BLOCKED_NOT_GREEN`.

## 4. USER-004 — Interests / Preferences

The Blueprint defines the feature, while the current mapping remains `UNRESOLVED`. The user-account operation policy contains `getAccountPreferences` and `updateAccountPreferences`, both currently `MISSING` as executable/OpenAPI evidence in that policy despite defined authorization, cache, anti-abuse and idempotency rules.

No canonical preference entity/field set is currently verified for this feature.

Missing closure: preference entity/fields, API/DTO binding, persistence authority, update lifecycle, security/anti-abuse tests and Evidence Registry.

Gate: `BLOCKED_NOT_GREEN`.

## 5. USER-005 — Privacy Settings

Current canonical mapping is `UNRESOLVED` and no feature-bound API/entity/persistence evidence was found. Privacy requirements cannot be inferred from generic Payload access rules.

Missing closure: privacy setting model, field classification, read/write API and DTOs, authorization scope, audit/security semantics, persistence, tests and Evidence Registry.

Gate: `BLOCKED_NOT_GREEN`.

## 6. USER-006 — Blocked / Muted Users

A dedicated `contracts/api/block-mute.v1.json` exists and defines `blockUser`, `unblockUser`, `muteUser`, and `unmuteUser`, including self scope, idempotency, atomic convergence, cache invalidation/versioning, bounded async events, anti-abuse and audit requirements. This is strong contract evidence, but the canonical USER-006 mapping remains `UNRESOLVED`; the feature is not promoted to GREEN without API/OpenAPI, DTO/entity/field, persistence, implementation and executed security/integration evidence.

The contract explicitly requires server-side propagation of block/mute effects across relevant feed, search, notification, messaging and relationship surfaces.

Gate: `BLOCKED_NOT_GREEN`.

## 7. USER-007 — User History / Activity

The feature remains `UNRESOLVED`. No authoritative history/activity entity, event schema, API/DTO mapping, retention policy, persistence mapping, or executed test evidence was identified as feature-bound.

Missing closure: activity source of truth, event taxonomy, privacy/access policy, retention/deletion behavior, API/DTO, persistence and Evidence Registry.

Gate: `BLOCKED_NOT_GREEN`.

## 8. USER-008 — Badges / Levels / Achievements

The feature remains `UNRESOLVED`. No authoritative badge/level/achievement entity, lifecycle, awarding authority, anti-abuse rule, API/DTO, persistence or test evidence is currently bound to the feature.

Missing closure: canonical achievement model, deterministic award/revoke lifecycle, idempotency, auditability, API/DTO, persistence and security/integration evidence.

Gate: `BLOCKED_NOT_GREEN`.

## 9. USER-009 — Points / Reputation

The feature remains `UNRESOLVED`. No authoritative points ledger/reputation entity or mutation authority is currently evidence-bound.

Missing closure: immutable/authoritative points accounting model, reputation calculation boundary, anti-abuse controls, API/DTO, persistence, audit/event lifecycle and executed tests.

Gate: `BLOCKED_NOT_GREEN`.

## 10. USER-010 — Data Export / Deletion

The feature remains `UNRESOLVED`. The user-account operation policy defines account deletion request/cancel operations with reauthentication, state-machine, grace-period, cancellation-window, audit and retention requirements, but those operations are currently `MISSING` evidence in the policy and are not bound to USER-010's complete traceability chain. Data portability/export authority is also not yet bound.

Missing closure: export API/DTO, deletion state/lifecycle, authorization, legal/retention constraints, job execution, data lineage, portability format, persistence evidence, integration/security tests and Evidence Registry.

Gate: `BLOCKED_NOT_GREEN`.

## 11. Consolidated gate

`USER-001..USER-010 = BLOCKED_NOT_GREEN`.

This reconciliation deliberately does **not** promote discovered contracts or existing Payload fields into GREEN. Existing `ENT-USER` evidence is retained as authoritative only where the entity/field contracts already mark it verified. All other links remain fail-closed until authoritative evidence exists.

Mapping 0 remains `NOT_GREEN`; runtime/Worker implementation remains unauthorized until the canonical validator accepts the complete traceability graph.