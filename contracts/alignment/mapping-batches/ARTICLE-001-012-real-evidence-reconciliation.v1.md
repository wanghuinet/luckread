# ARTICLE-001..ARTICLE-012 Real Evidence Reconciliation v1.0

- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Feature inventory: `contracts/alignment/feature-inventory.v1.json`
- Canonical mapping: `contracts/alignment/cross-system-mapping.v1.json`
- Existing batch evidence: `contracts/alignment/mapping-batches/B04-B06-content-creator-article.v1.json`
- Evidence policy: fail-closed; no inference

## Canonical feature inventory

The repository inventory defines ARTICLE-001 through ARTICLE-012 as: article; rich text/block content; images/gallery; series; column; collection; category/tag/topic; related content; featured/pinned/editor pick; preview/paywall markers; canonical/slug/version; multilingual variants.

All twelve are currently discovered/blueprint-level inventory items and the existing B04-B06 reconciliation records all twelve as `UNRESOLVED`.

## Evidence reconciliation

### ARTICLE-001 — article
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: article canonical entity/API/DTO/field/lifecycle mapping is not evidence-bound. No complete Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code → Security → Lifecycle → Test → Evidence chain is admitted.

### ARTICLE-002 — rich text/block content
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: rich text/block schema, API DTO and persistence mapping are not evidence-bound. The existence of a content API contract does not establish a canonical block schema or executable persistence chain.

### ARTICLE-003 — images/gallery
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: article image/gallery/media relation, API and ordering mapping are not evidence-bound. Media references must not be inferred from generic Payload media behavior.

### ARTICLE-004 — series
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: series entity, membership, ordering, API and lifecycle mapping are not evidence-bound.

### ARTICLE-005 — column
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: column entity, creator ownership, membership and API mapping are not evidence-bound.

### ARTICLE-006 — collection
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: collection entity, content membership, ordering and API mapping are not evidence-bound.

### ARTICLE-007 — category/tag/topic
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: category/tag/topic authority, taxonomy and search/feed mapping are not evidence-bound.

### ARTICLE-008 — related content
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: related-content relation, ranking semantics and API mapping are not evidence-bound.

### ARTICLE-009 — featured/pinned/editor pick
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: featured/pinned/editor-pick authority, security and projection mapping are not evidence-bound.

### ARTICLE-010 — preview/paywall markers
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: preview/paywall markers, entitlement integration, API and state mapping are not evidence-bound. Paywall behavior cannot be implemented from UI assumptions alone.

### ARTICLE-011 — canonical/slug/version
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: canonical/slug/version uniqueness and lifecycle/API mapping are not evidence-bound.

### ARTICLE-012 — multilingual variants
Status: `BLOCKED_NOT_GREEN`.

Existing mapping blocker: multilingual variant, locale, fallback and API mapping are not evidence-bound.

## Existing content API evidence

`contracts/api/content-operation-policy.v1.json` is real contract evidence. It explicitly states that the public content API must not be inferred from Payload CRUD, defines content models including article, gallery and series, and defines a lifecycle including DRAFT, REVIEW_PENDING, REVIEW_REJECTED, SCHEDULED, PUBLISHED, UNPUBLISHED, ARCHIVED and DELETED. Its operations remain partially contracted and carry missing state, integration and security-E2E evidence in the repository snapshot.

`docs/10-P0-CONTENT-AND-IP-GRAPH-CONTRACT-v1.0.md` also defines the content lifecycle and requires explicit versions for preview/rollback, with large body/media payloads allowed in R2 while D1 remains authoritative for metadata and references. These are contract constraints, not proof of runtime implementation.

## Required closure chain

For every ARTICLE feature, closure requires authoritative IDs and evidence for all applicable stages:

1. Feature and Capability
2. Public API operation and request/response DTO
3. Canonical entity and field contract
4. D1 authoritative metadata/persistence mapping
5. R2 object/reference mapping where applicable
6. Payload integration boundary, without treating Payload CRUD as the public API
7. Ownership, organization and entitlement authorization
8. Lifecycle/state-machine semantics
9. Cache and projection behavior where applicable
10. Executable implementation
11. Positive, negative, concurrency and security tests
12. Evidence Registry entry with provenance and validating commit SHA

## Security gates

- Article author/owner must be server-authoritative and cannot be accepted from an untrusted client projection.
- Draft/private content must never enter public cache or public listing projections.
- Publish, unpublish, archive and delete operations must use explicit state transitions rather than arbitrary state-field mutation.
- Paywall/preview decisions must resolve against the authoritative entitlement/access contract.
- Version and slug uniqueness must be enforced at the authoritative persistence layer, not only in application code.
- Locale and fallback resolution must be deterministic and must not leak a private or unpublished variant.
- Gallery/media ordering and object references must be validated before publication.
- Featured/pinned/editor-pick authority must be permission-scoped and auditable.

## Implementation gate

No article runtime/Worker implementation is authorized by this reconciliation record. Existing content API contracts are insufficient to declare ARTICLE-001..012 GREEN.

`ARTICLE-001..ARTICLE-012 = BLOCKED_NOT_GREEN`

Mapping 0 remains `NOT_GREEN` until the canonical validator sees a complete traceability graph and non-empty executable Evidence Registry records tied to a validating commit SHA.
