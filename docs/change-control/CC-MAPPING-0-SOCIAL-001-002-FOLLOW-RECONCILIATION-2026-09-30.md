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
`````text

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
