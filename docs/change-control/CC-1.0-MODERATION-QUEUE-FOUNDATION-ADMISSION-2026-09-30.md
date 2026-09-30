# CC-1.0 Moderation Queue Foundation Admission — 2026-09-30

**Status: GAP / DECISION MATERIAL / IMPLEMENTATION BLOCKED**

Repository: `wanghuinet/luckread`  
Base head reviewed: `c4b4cb46c6c352eb362ec5e600d12322e5f3ac9b`

## 1. Purpose

Record the verified implementation gap after the Creator Center publish-chain slice reached automated GREEN.

The next product-critical domain is the moderation path:

`PENDING_REVIEW → moderation queue → reviewer decision → APPROVED / REJECTED`

This record does not authorize implementation. It prevents the code layer from inventing queue authority, cross-domain reads, or an uncontracted reviewer transport.

## 2. Existing authoritative inputs

- `docs/63-MODERATION-APPEALS-SYSTEM-CONTRACT-v1.0.md`
  - Status: `PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING`
  - Defines moderation checks, cases, decisions, appeals, reviewer queues, evidence and audit requirements.
- `docs/150-MODERATION-GOVERNANCE-CENTER-EXPERIENCE-CONTRACT-v1.0.md`
  - Status: `PRODUCT-EXPERIENCE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING`
  - Defines Queue → Case → Context → Evidence → Policy → Decision → Action → Audit.
- `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md`
  - Reviewer permissions include `moderation.queue.read`, `moderation.case.read`, `moderation.decide`.
  - Administrative moderation surface is `/api/v1/admin/moderation/*`.
- `contracts/authz/permissions.json`
  - `moderation.decide` requires layer `L6` or higher.
- `contracts/state-machines/content.json`
  - Moderator owns `PENDING_REVIEW → APPROVED` and `PENDING_REVIEW → REJECTED`.
  - Creator owns `APPROVED → PUBLISHED`.

## 3. Verified implementation gap

The current W06 runtime source implements AUTH-013 audit persistence and queue consumption, but does not expose a moderation Queue / Case / Decision runtime.

The repository search still finds no admitted runtime implementation for:

- queue read / assignment;
- moderation case read;
- moderation decision mutation;
- reviewer evidence read boundary;
- W06→W03 content-decision transport;
- runtime execution/evidence for the existing decision→AuditEvent binding.

Entity, persistence, OpenAPI/DTO and audit contracts are now explicit; execution remains blocked.

## 4. Contract-first reservation

The following machine-readable contracts now exist on `main` and remain non-runtime:

- `contracts/api/moderation-operation-policy.v1.json` — queue/case/decision operation budgets, permissions and security invariants; status `CONTRACTED_OPENAPI_BOUND`.
- `contracts/dto/moderation-dto-contract.v1.json` — stable DTO identities and visibility rules; status `CONTRACTED_OPENAPI_BOUND`.
- `contracts/entity/MODERATION-CASE-CONTRACT.v1.json` and `contracts/entity/MODERATION-DECISION-CONTRACT.v1.json` — entity vocabulary; status `CONTRACTED_NOT_VERIFIED`.
- `contracts/persistence/MODERATION-QUEUE-FOUNDATION-persistence.v1.json` — D1-03 logical persistence binding; status `CONTRACTED_NOT_VERIFIED`.
- `contracts/events/GOV-004-moderation-decision-audit-binding.v1.json` — decision→AuditEvent binding; status `CONTRACTED_NOT_VERIFIED`.

These bindings do not authorize W06 runtime, D1 migration execution, or remote evidence claims.

## 4.1 Entity / persistence contract slice admitted for further reconciliation

The following contract-only bindings are now explicit and remain non-canonical:

- contracts/authz/permissions.json adds moderation.queue.read and moderation.case.read at L6/platform scope with sensitive access and audit required.
- contracts/entity/MODERATION-CASE-CONTRACT.v1.json defines the authoritative W06/D1-03 ModerationCase vocabulary.
- contracts/entity/MODERATION-DECISION-CONTRACT.v1.json defines the authoritative W06/D1-03 decision record vocabulary.
- contracts/persistence/MODERATION-QUEUE-FOUNDATION-persistence.v1.json binds both entities to the existing D1-03/W06 logical persistence target only; no migration is executed or claimed.
- `contracts/transport/MODERATION-001-trusted-reviewer-admission-input.v1.json` defines the minimum reviewer principal/layer/permission/provenance and conditional-request inputs; it remains `BLOCKED_NOT_ADMITTED`.
- The entity catalog, field registry and database-entity persistence inventory now carry the same proposed/non-verified records.

This slice does not create a Worker, D1, migration execution, or runtime implementation. OpenAPI and DTO are already canonically bound; the moderation path remains BLOCKED pending trusted reviewer authority, W06→W03 content transport, and executable evidence.

## 4. Non-negotiable authority constraints

1. W06 must not directly read or write W03 content tables merely to make the queue work.
2. W05/W03/W01 must not gain ad-hoc moderation authority.
3. No second moderation authority may be created inside Payload.
4. No new Worker or D1 may be introduced.
5. No public API operation may be inferred from the product-experience contract alone.
6. Queue ordering, reviewer scope, evidence access, decision semantics and audit requirements must become executable contracts before runtime implementation.
7. Content state remains authoritative in the existing W03 content runtime; moderation only authorizes the contracted moderator transition.

## 4.2 Trusted reviewer transport / concurrency contract slice

The reviewer transport slice is explicit but intentionally blocked. It binds to the existing W01→W02 authenticated principal boundary, canonical L6 authorization semantics, and the canonical conditional-request/idempotency contract. It does **not** invent a W01→W06 Service Binding and does not authorize runtime.

The decision path now requires both `If-Match` (transport precondition) and `expectedVersion` (DTO mirror) with `428` for a missing precondition and `412` for a mismatch. This aligns the moderation decision with the canonical concurrency contract.

## 5. Required contract-first closure before implementation

The remaining contract/authority closure must establish:

- trusted reviewer authority binding (`contracts/transport/MODERATION-001-trusted-reviewer-admission-input.v1.json`);
- W06→W03 content-decision transport binding;
- permission/transport negative evidence;
- idempotency + If-Match/expectedVersion runtime evidence;
- decision→AuditEvent one-to-one runtime evidence;
- migration and remote D1 evidence before any runtime promotion.

Only after the above reconciles to GREEN should W06 moderation runtime code be added.

## 6. Relation to current Creator Center release chain

The Creator Center publish chain is already implemented and automatically verified at the current head:

`DRAFT → PENDING_REVIEW`

and, after moderation approval:

`APPROVED → PUBLISHED`

The current blocker is specifically the missing authoritative moderation decision runtime, not the creator publishing surface.

## 7. Decision

**BLOCKED pending contract admission and reconciliation.**

No runtime moderation implementation is authorized by this record.

## 8. Canonical Blueprint feature identity

This moderation foundation maps to Blueprint features `GOV-003` (moderation queue) and `GOV-004` (enforcement case). The transport filename remains a historical contract artifact name; it MUST NOT be interpreted as a new Blueprint Feature ID.

## 9. Audit binding

`contracts/events/GOV-004-moderation-decision-audit-binding.v1.json` now binds the authoritative decision mutation to the existing W06/D1-03 `AuditEvent` schema. It remains `CONTRACTED_NOT_VERIFIED`; no runtime or remote evidence is claimed.


## 10. Current Authority Gate

The only new architectural decision still required for the moderation execution path is the trusted internal transport boundary. The decision packet `docs/change-control/CC-1.0-MODERATION-TRUSTED-TRANSPORT-AUTHORITY-2026-10-01.md` records the candidate topology and explicit non-goals. Until that gate is authorized and evidence-bound, W06 runtime remains BLOCKED.
