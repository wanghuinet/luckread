# AUTH-016 Real-Evidence Reconciliation v1.0

- Feature: `AUTH-016`
- Name: identity/age/creator/organization verification
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Evidence mode: repository-grounded, fail-closed
- Scope: Mapping-0 / B01 Identity-Auth-Account

## 1. Canonical feature definition

B01 defines `AUTH-016` as **identity/age/creator/organization verification** with the frozen hierarchy:

- L1: Identity / Auth / Account
- L2: Identity verification
- L3: Trust attributes
- L4: Identity/age/creator/organization verification
- L5: Submit and use a verified identity attribute
- L6: Verify an identity attribute under its applicable policy and expose only authorized verification state
- L7: Verification status cannot itself grant unrelated permissions; Role, Permission and Entitlement remain separate authorities
- L8: Cross-domain verification contracts must be reconciled with the authorization, Creator, Organization, Risk/Safety and related domains.

The feature inventory records `AUTH-016` as `DISCOVERED`; this is feature coverage evidence only and does not authorize implementation. The canonical Blueprint requires every feature to map eventually to API, data, permission/scope, state, security/risk, audit and tests where applicable.

## 2. Current B01 / Mapping-0 record

The current B01 reconciliation record has no bound canonical API, DTO, Entity, Field, Permission, Entitlement, Worker, Test or Evidence IDs for `AUTH-016`, and its D1 mapping remains unresolved. The cross-system bridge likewise keeps AUTH-016 `PARTIAL` with the blocker that verification API/DTO/entity/security mapping remains incomplete.

This reconciliation does not invent missing identifiers.

## 3. Existing contract evidence

### 3.1 Creator verification

`docs/76-CREATOR-SYSTEM-CONTRACT-v1.0.md` defines Creator System as the authority for creator qualification and verification state. It explicitly includes identity verification, age eligibility, creator verification request/review/verified state, professional evidence, organization-affiliation verification, business verification, and verification lifecycle states including pending, approved, rejected, expired, revoked and re-verification. It also states that sensitive identity evidence is not exposed through ordinary Creator APIs.

`docs/77-CREATOR-SYSTEM-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md` requires each Creator L4 to be traceable through Data, API/Control, Event, Permission/Security, Privacy/Rights/Risk, Runtime, Test and Evidence before implementation admission. Its Creator API boundary explicitly includes `/v1/creators/{creatorId}/verification`, but this is an API-surface declaration, not a canonical operation ID or implementation proof.

`docs/78-CREATOR-SYSTEM-DATA-CONTRACT-v1.0.md` defines a Verification entity with `verificationId`, `creatorId`, `type`, `state`, `providerRef`, `evidenceRef`, `verifiedAt`, `expiresAt`, `revokedAt` and `version`, while requiring minimal handling of raw sensitive evidence and exposing only verification state/reference through normal Creator APIs.

`docs/185-L5-L6-CREATOR-STUDIO-ORGANIZATION-MCN-INSTANCE-REGISTRY-v1.0.md` defines executable verification units for application, evidence attachment, queue admission, reviewer assignment, reviewer decision, expiry, re-verification and badge projection. The registry remains implementation-pending and CI-not-run.

### 3.2 Organization / enterprise verification

`docs/304-ORGANIZATION-ENTERPRISE-AND-IP-PRINCIPAL-CONTRACT-v1.0.md` separates individual and enterprise identity and states that enterprise identity is determined by `account_type` plus an active `OrgMembership` and a verified Organization, not by Role name. Its organization state machine uses `org.verify` as a privileged organization operation. This is Organization authority, not a second User verification authority.

The contract also establishes that the IP Principal model is distinct from generic creator/member roles; it does not justify creating an additional `ip_founder` role.

### 3.3 Rights / licensor verification

`docs/204-IP-LICENSOR-ONBOARDING-RIGHTS-PROVENANCE-VERIFICATION-CONTRACT-v1.0.md` and `docs/205-L5-L6-IP-LICENSOR-ONBOARDING-RIGHTS-PROVENANCE-VERIFICATION-INSTANCE-REGISTRY-v1.0.md` define subject verification, organization verification, role verification, authority evidence and verification states for the licensor/right-to-sell boundary. These documents are Rights-domain evidence and must not be promoted into User/Creator verification authority without explicit mapping.

### 3.4 Risk / age-safety boundary

`docs/190-L5-L6-RISK-MODERATION-RIGHTS-INSTANCE-REGISTRY-v1.0.md` defines risk/trust, safety policy and age-gating execution boundaries. It requires current policy/version, attributable decisions and explicit safety controls. It also states that risk signals are not substitutes for canonical domain authority and that sensitive enforcement decisions must remain auditable.

These are supporting boundaries; they do not by themselves prove AUTH-016 implementation.

## 4. API reconciliation

The canonical API inventory currently defines the endpoint-completeness gate, but no AUTH-016-specific canonical operation ID is bound in B01.

The Creator contracts reference:

- `/v1/creators/{creatorId}/verification`

The Organization contract defines verification semantics and permissions such as `org.verify` conceptually, while the canonical permission catalog currently exposes a finite resource.action set but no explicitly verified AUTH-016 verification permission record was established in this audit.

Therefore:

- route strings are not promoted to operation IDs by inference;
- permissions are not invented from prose;
- identity, age, Creator and Organization verification operations remain unbound until the API/permission contracts explicitly bind them.

The API Green rule requires schema, OpenAPI operation ID, permission, scope, state machine where stateful, cache policy, read/write classification, resource/RPC/retry/event/queue budgets, anti-abuse, idempotency, mapping, examples and integration E2E; sensitive operations also require security E2E.

## 5. DTO reconciliation

No canonical AUTH-016 request/response/error DTO IDs are currently bound in B01 or the inspected cross-system mapping.

The required DTO boundary must distinguish, at minimum, between:

- submission/request data;
- verification-state response data;
- reviewer/admin decision data where authorized;
- error semantics that do not leak sensitive evidence or protected identity existence.

No DTO names or fields are invented in this reconciliation.

## 6. Entity / Field / Persistence reconciliation

The current generic entity catalog and field contract establish only a verified `ENT-USER` implementation and verified User fields. `ENT-VERIFICATION` remains `PROPOSED`; the entity-field contract contains no verified verification-field IDs for it. Creator System has a separate verification data contract, but the current central Mapping-0 entity catalog has not bound those Creator entities/fields into AUTH-016.

The current persistence inventory also records only `ENT-USER` with configured `@payloadcms/db-d1-sqlite` persistence and states that migration execution evidence is not yet independently verified. Auxiliary identity entities remain contract-only / unimplemented.

Consequently, the repository does not prove a canonical persisted data chain for identity/age verification, nor does it prove a single unified verification entity spanning User, Creator and Organization. Such a unified entity must not be invented: each domain authority must remain separate and connected through explicit references and decisions.

## 7. Verification authority and separation rules

AUTH-016 crosses multiple authorities and therefore requires strict separation:

```text
User Identity / Account
        ↓
identity verification state

Creator System
        ↓
creator qualification / creator verification state

Organization / MCN
        ↓
enterprise / organization verification state

Risk / Safety
        ↓
risk signal / safety policy decision

Rights
        ↓
licensor / ownership / authority verification

Authorization
        ↓
permission + scope + entitlement evaluation
```

Verification status is an input to authorization, not an authorization substitute.

A verified Creator must not automatically receive unrelated permissions. An enterprise-verified Organization must not bypass per-request scope checks. A passed age check must not by itself grant a Role or Entitlement. Rights verification must not mutate User or Creator authority.

## 8. Security / privacy invariants

Before GREEN, executable evidence must prove:

- sensitive identity evidence is minimized and protected;
- raw identity documents are not returned through ordinary APIs;
- verification references and states are exposed only to the caller scope allowed by policy;
- provider assertions/results are validated before becoming trusted platform state;
- account/creator/organization verification is bound to the correct subject and purpose;
- reviewer/admin operations require explicit permission and scope;
- cross-account and cross-organization verification access is denied;
- verification requests and decisions are rate-limited and abuse-resistant;
- expired or revoked verification cannot silently remain authoritative;
- re-verification uses the current policy/version;
- verification replay and duplicate submission do not create contradictory authoritative facts;
- raw evidence, secrets and internal risk thresholds never enter normal telemetry or public DTOs;
- verification state cannot bypass account enforcement, legal/rights constraints, moderation or explicit authorization.

## 9. Lifecycle / state reconciliation

Creator verification already has an explicit lifecycle of pending/approved/rejected/expired/revoked/re-verification in the Creator contract. Organization verification is governed by the Organization state machine. Account state remains the higher-level account gate defined by the account state machine.

The canonical design therefore requires explicit composition rather than a new global verification state machine that silently overrides the existing authorities.

Every stateful verification operation must define:

- actor and actor type;
- subject/resource scope;
- policy/version used;
- preconditions;
- valid transitions;
- expiry/revocation semantics;
- side effects;
- audit requirements;
- event semantics;
- concurrency/version behavior;
- replay/idempotency behavior;
- recovery/re-verification behavior.

## 10. Worker / D1 reconciliation

The current Worker Master assigns:

- W02 → Identity / Account / Authorization, D1-01;
- W08 → Creator / Organization, D1-01;
- W06 → Rights / Trust & Safety / Governance, D1-03.

However, the Worker Master explicitly forbids inferring feature ownership from code, routes or collections and states that Worker→D1 binding is a separate mandatory gate. AUTH-016 is intentionally left without a feature-level Worker/D1 assignment in this reconciliation.

Any final assignment must explicitly preserve one authoritative owner per authoritative entity and explicit cross-domain event/reconciliation semantics.

## 11. Runtime / Payload evidence

Repository evidence establishes that `src/collections/Users.ts` exists as a Payload Users collection and that Payload D1 integration is configured. It does not establish a complete AUTH-016 runtime path for:

```text
submit verification
→ verify evidence/provider result
→ reviewer/policy decision
→ persist authoritative verification state
→ publish safe state/reference
→ propagate derived effects
→ expire/revoke/reverify
```

No implementation is inferred from Payload internals, Creator contract route strings, directory names or configuration alone.

## 12. Tests / Evidence Registry

The current AUTH-016 B01 record has no canonical `testRefs` or `evidenceRefs` for this feature.

Minimum GREEN evidence package must cover:

1. identity verification submission and authorization;
2. age eligibility decision and privacy-safe result exposure;
3. creator verification application/review/decision;
4. organization enterprise verification and scope isolation;
5. duplicate submission/idempotency behavior;
6. reviewer authorization and dual-control rules where required;
7. provider failure, invalid assertion and replay handling;
8. expiry, revocation and re-verification;
9. sensitive evidence access isolation;
10. proof that verification does not itself grant unrelated permissions;
11. cross-domain event propagation and stale-projection repair;
12. concurrency/version conflict handling;
13. integration E2E across the applicable domain boundaries;
14. security E2E for enumeration, cross-scope access, evidence leakage and authorization bypass;
15. non-empty canonical Evidence Registry entries consumed by the Mapping-0 validator;
16. final CI/validator result tied to the exact commit SHA.

The existence of L5/L6 registry rows or documentation is not execution evidence.

## 13. Mapping matrix

| Dimension | Current state | GREEN requirement |
|---|---|---|
| Feature | VERIFIED at Blueprint / inventory level | stable `AUTH-016` |
| Capability | PARTIAL | explicit cross-domain capability binding |
| API | MISSING/PARTIAL | canonical operation IDs + route/schema/OpenAPI |
| DTO | MISSING | request/response/error DTO IDs |
| Entity | MISSING/PARTIAL | explicit identity/verification/creator/org entities and authority references |
| Field | MISSING | canonical verification/status/purpose/expiry/revocation/version field IDs |
| Persistence | MISSING | migration + persistence evidence |
| Payload | MISSING | explicit supported extension/runtime evidence |
| Permission | MISSING | canonical permission IDs + scope |
| Entitlement | MISSING | explicit not-applicable proof or canonical entitlement mapping |
| State | PARTIAL | domain-specific state composition + transition semantics |
| Event | MISSING | canonical verification events + schemas |
| Worker | UNRESOLVED | approved feature-to-worker mapping |
| D1 | UNRESOLVED | approved feature-to-D1 authority mapping |
| Security | MISSING | privacy/evidence/anti-abuse/cross-scope E2E |
| Tests | MISSING | executable registry-linked tests |
| Evidence | MISSING | non-empty Evidence Registry + commit-tied CI |

## 14. GREEN decision

**Decision: BLOCKED_NOT_GREEN.**

AUTH-016 is not authorized for implementation under Mapping-0.

The repository demonstrates substantial architecture and contract intent for Creator, Organization, Rights and Risk verification, but it does not demonstrate the complete required chain:

```text
Feature
→ Capability
→ API
→ DTO
→ Entity
→ Field/Persistence
→ Payload
→ Code/Worker
→ Security
→ Lifecycle
→ Test
→ Evidence
```

The most material blockers are:

- no canonical AUTH-016 operation IDs;
- no canonical AUTH-016 DTO IDs;
- no verified central verification Entity/Field mapping;
- no explicit central verification permission binding;
- no feature-level Worker/D1 binding;
- no runtime implementation evidence for the complete verification flow;
- no executable security/integration evidence;
- no Evidence Registry entries proving execution.

The existing Creator, Organization, Rights and Risk contracts must remain separate authorities rather than being collapsed into a new verification super-entity or broad permission.

## 15. Closure criteria

AUTH-016 may advance only when:

1. identity, age, Creator and Organization verification responsibilities are explicitly split by authority;
2. all required API operation IDs and route bindings are canonical;
3. DTO request/response/error contracts are schema-validated;
4. authoritative entities and fields are explicitly mapped and migration-evidenced;
5. permission/scope and any entitlement interaction are explicit;
6. verification lifecycle, expiry, revocation and re-verification are executable;
7. sensitive evidence handling and privacy boundaries pass security tests;
8. cross-domain Worker/D1 ownership is explicitly bound;
9. runtime implementation is traceable to the contracts;
10. unit, concurrency, integration and security E2E tests pass;
11. non-empty Evidence Registry entries are consumed by the fail-closed Mapping-0 validator;
12. final CI/validator evidence is tied to the exact commit SHA.

Until all conditions are met, AUTH-016 remains `BLOCKED_NOT_GREEN`, B01 remains `NOT_GREEN`, and implementation remains unauthorized.

## 16. Evidence references

- `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`
- `contracts/alignment/feature-inventory.v1.json`
- `contracts/alignment/mapping-batches/B01-B03-identity-user-authz-org.v1.json`
- `contracts/entity/entity-catalog.v1.json`
- `contracts/entity/entity-field-contract.v1.json`
- `contracts/entity/entity-implementation-evidence.v1.json`
- `contracts/alignment/database-entity-persistence-inventory.v1.json`
- `contracts/authz/permissions.json`
- `contracts/api/api-inventory.v1.json`
- `contracts/state-machines/account.json`
- `docs/72-USER-CENTER-PROFILE-SETTINGS-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
- `docs/76-CREATOR-SYSTEM-CONTRACT-v1.0.md`
- `docs/77-CREATOR-SYSTEM-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md`
- `docs/78-CREATOR-SYSTEM-DATA-CONTRACT-v1.0.md`
- `docs/185-L5-L6-CREATOR-STUDIO-ORGANIZATION-MCN-INSTANCE-REGISTRY-v1.0.md`
- `docs/190-L5-L6-RISK-MODERATION-RIGHTS-INSTANCE-REGISTRY-v1.0.md`
- `docs/204-IP-LICENSOR-ONBOARDING-RIGHTS-PROVENANCE-VERIFICATION-CONTRACT-v1.0.md`
- `docs/205-L5-L6-IP-LICENSOR-ONBOARDING-RIGHTS-PROVENANCE-VERIFICATION-INSTANCE-REGISTRY-v1.0.md`
- `docs/304-ORGANIZATION-ENTERPRISE-AND-IP-PRINCIPAL-CONTRACT-v1.0.md`
- `docs/04-WORKER-MASTER-v1.0.md`
