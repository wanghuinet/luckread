# Phase 2 — Article Platform Mapping v1.0

**Status:** MAPPING_BASELINE / NOT_GREEN_UNTIL_EVIDENCE
**Dependency:** Phase 1 GREEN and frozen foundation contracts.

## Scope
- Article domain model and metadata
- Author/creator ownership
- Draft, edit, publish, unpublish, archive lifecycle
- Visibility and publication state
- Category, tag, cover and content metadata
- Article detail/list APIs
- Gallery/image article support
- Free, partial, paid and subscriber-only access boundary
- Basic article discovery/search boundary

## End-to-end closure
`Author -> Create -> Draft -> Edit -> Publish -> List/Detail -> Visibility/Entitlement -> Unpublish/Archive`

## Required mappings
A01 Article ownership; A02 lifecycle/state machine; A03 content/metadata storage; A04 media/R2 reference boundary; A05 author identity; A06 visibility; A07 entitlement boundary; A08 list/detail API; A09 pagination; A10 search/discovery; A11 concurrency/idempotency; A12 auditability.

## Invariants
- Article ownership is explicit.
- Lifecycle transitions are validated and auditable.
- Published content cannot be accidentally exposed through an invalid state.
- Paid/partial access is enforced server-side; internal/local calls cannot bypass authorization.
- Media payloads and metadata have explicit ownership boundaries.
- Mutating operations define idempotency and conflict behavior.

## Exit gate
All article features must have green Contract, code, unit/integration/E2E tests, CI, deployment and evidence. Phase 2 is not green merely because article APIs compile.
