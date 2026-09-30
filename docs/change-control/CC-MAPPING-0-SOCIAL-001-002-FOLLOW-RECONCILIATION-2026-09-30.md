# CC-MAPPING-0-SOCIAL-001-002-FOLLOW-RECONCILIATION-2026-09-30

**Status:** RECONCILIATION-DELTA / NOT_GREEN
**Implementation authorization:** false

## Purpose

在不越过 Global Mapping Consolidation Gate 的前提下，收敛 `SOCIAL-001` follow/unfollow 与 `SOCIAL-002` followers/following 的已存在合同证据。

## Confirmed Repository Evidence

`contracts/api/interaction-operation-policy.v1.json` already defines canonical interaction operation IDs:

```text
follow   POST   /interactions via /social/follows
unfollow DELETE /interactions via /social/follows
```

Existing rules already define:

- permission: `interaction.follow`;
- scope: actor + target;
- idempotency: `actorId:targetId:follow`;
- concurrent duplicate control: atomic unique constraint or upsert;
- follow mutation: single authoritative write;
- event fan-out: asynchronous and bounded;
- counters: projections, not authorization truth;
- block policy: server-side enforcement before relationship visibility;
- anti-abuse scopes: IP, device, account, endpoint, resource, global.

Social contracts also establish that Follow is an authoritative relationship and follower/following counts are derived state.

## Worker / D1 Boundary Evidence

`docs/04-WORKER-MASTER-v1.0.md` and `docs/03-WORKER-BINDING-MAPPING-v1.0.md` establish the canonical logical owner for Social as W05, with scoped D1-02 read/write authority and no unrestricted cross-D1 access.

The current repository still contains a physical `workers/W04-social` directory. Existing Mapping-0 records explicitly treat that directory as legacy/non-canonical. Its path must not be promoted to current W05 authority by inference.

Therefore the feature-specific runtime binding remains unresolved even though the logical Worker × D1 boundary itself is already frozen.

## Confirmed Canonical Task / Worker / D1 Binding

The frozen Final Mapping explicitly assigns the Social Graph domain to:

```text
Social graph → T11 → W05 → D1-02
```

This binding is therefore evidence-backed at the Task / Worker / D1 boundary and does not need to be inferred from the physical directory name.

For `SOCIAL-001` and `SOCIAL-002`, this means the remaining mapping gap is downstream of the already-frozen ownership boundary:

```text
Feature → T11 → W05 → D1-02
                     ↓
               Entity / Field / API DTO
                     ↓
               Code / Security / Event
                     ↓
               Test / Evidence
```

## Additional L5/L6 Semantic Evidence

`docs/188-L5-L6-SOCIAL-COMMUNITY-INTERACTION-INSTANCE-REGISTRY-v1.0.md` closes the L4/L5/L6 semantic scope for the follow lifecycle without authorizing implementation.

Relevant existing semantic claims include:

- relationship ID must be unique and non-reused;
- follow user requires target eligibility and scope/privacy enforcement;
- duplicate follow is idempotent;
- unfollow removes only the authorized relation and projections converge;
- follow creator requires a valid creator target and unique relation;
- social relation queries enforce viewer/target scope and reproducibility;
- social projections are rebuildable from authoritative relations/events;
- relation mutations require permission, rate-limit and privacy guards;
- event enqueue/delivery/replay semantics are bounded and idempotent.

This strengthens the semantic-contract evidence for `SOCIAL-001/002`, but it still does not provide a canonical Entity ID, Field ID, migration/schema, executable W05 handler, runtime evidence, or Evidence Registry provenance.

## Evidence Sweep — Current `main` Head

At `main` = `87cfc42ae2f20bbccd3a8b002401555b1b4945ef`, the evidence sweep found:

- `contracts/entity/entity-catalog.v1.json` contains 11 entity records and no Social/Follow entity record.
- `contracts/entity/entity-field-contract.v1.json` contains 11 entity field groups and no canonical Social/Follow field group.
- `contracts/entity/entity-implementation-evidence.v1.json` contains 11 entity implementation records and no Social/Follow implementation record.
- `workers/W05-transaction/` currently contains only its `README.md`; there is no executable Follow handler there.
- `workers/W04-social/` also contains only its `README.md`; it provides no executable Follow implementation and cannot be promoted to canonical ownership by directory inference.
- The canonical Mapping and Five-Way records continue to show `SOCIAL-001` and `SOCIAL-002` as `UNRESOLVED` with empty Entity/API/Code bindings.

This sweep closes the “maybe an existing canonical Follow entity/runtime is already present” question with negative repository evidence. It does not justify inventing a new Entity ID, Field ID, migration, or handler inside Mapping 0.

## Current Gate Evidence

For `main` head `87cfc42ae2f20bbccd3a8b002401555b1b4945ef`, the current structural/admission gates are passing:

- Mapping 0 Structural Gate — success;
- Contract Admission CI — success;
- Ensure Feature Inventory — success;
- AUTH-013 Persistence Schema Evidence — success.

The separately observed failures in legacy/diagnostic workflow paths such as `.github/workflows/contract-ci.yml`, `.github/workflows/contract-admission-ci.yml`, and the W04 side-effect matrix are not used to override the active gate results. They are not evidence that Social Follow has become implementable.

## Current Gate Checkpoint — main = `93e0a2f2b8c5dec254a84f859b5ab0b6cae932f4`

The post-sweep active Contract Admission and Mapping Structural runs both completed successfully:

- Contract Admission CI run `36710932793` = `success`.
- Mapping 0 Structural Gate run `36710932862` = `success`.
- Contract Admission sub-gates (common, state-machines, enums, Payload reconciliation, OpenAPI, events, authz, full) all completed `success`.
- Capability Contract Graph Gate completed `success`.
- Five-Way Alignment and Strict Downstream R4/Evidence/R5 jobs were `skipped` because their global prerequisites remain unresolved; no GREEN is inferred from skipped jobs.

Therefore the current control-plane contracts are structurally/admission-valid, while the Social feature-specific technical mapping remains `NOT_GREEN`.

## API Operation Reconciliation — SOCIAL-001

The repository now provides direct canonical API evidence for the Follow mutation pair:

- `follow` — `POST /social/follows` — formal OpenAPI `operationId`, sourced in `contracts/openapi/v1/openapi.yaml#/social/follows`.
- `unfollow` — `DELETE /social/follows` — formal OpenAPI `operationId`, sourced in the same OpenAPI path.
- `contracts/api/interaction-operation-policy.v1.json` independently defines the same `follow` / `unfollow` operation IDs and their idempotency/concurrency/security rules.

This closes only the `Feature → API operation` edge for `SOCIAL-001`. It does **not** close DTO, Entity, Field/Persistence, Payload, W05 executable code, runtime, event-producer, cache, or Evidence Registry edges.

For `SOCIAL-002`, `getUsersUserIdFollowers` and `getUsersUserIdFollowing` exist in OpenAPI and API inventory, but both are explicitly marked `DISCOVERY_DRAFT` with detailed response contracts still open. They therefore remain non-promoted discovery evidence and are not used as a GREEN API binding.

## Remaining Blocking Edges

The repository does not yet provide evidence sufficient to bind:

```text
canonical Entity ID
canonical Field ID / persistence schema
canonical DTO ID
canonical OpenAPI operation registry admission
W05 executable handler
W05 → D1 binding evidence for this feature
follow.created / follow.deleted producer binding
cache invalidation/version evidence
runtime positive/negative/concurrency/security evidence
Evidence Registry provenance for SOCIAL-001/002
```

These gaps keep both features `NOT_GREEN`.

## Authority Decision

```text
User             → Identity authority
Social           → Follow relationship authority
Follower count   → derived projection
Membership       → Subscription / Entitlement authority
Data Center      → projection/query surface
Payload Core     → unchanged upstream dependency
```

## Required Next Gate

The next executable gate remains:

```text
Global Mapping Consolidation GREEN
→ canonical Social API/DTO/Entity/Field mapping
→ W05/D1 binding evidence
→ runtime implementation admission
→ tests + Evidence Registry
→ only then Follow/Follower runtime
```

No code or infrastructure is authorized by this document.
