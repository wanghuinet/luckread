# Phase 4 — Feed / Search / Recommendation Mapping v1.0

**Status:** MAPPING_BASELINE / NOT_GREEN_UNTIL_EVIDENCE

## Scope
- Unified content candidate model for article/video/future content types
- Home, following, latest, popular, category, tag and author feeds
- Search query and result boundary
- Candidate generation
- Eligibility filtering
- Rule-based scoring
- Ranking
- Stable pagination
- Deduplication
- Basic personalization inputs

## Initial strategy
First release uses deterministic, explainable rules and statistics. Complex ML ranking is deferred until contracts and data signals are mature.

## End-to-end closure
`Request -> Candidate sources -> Eligibility filter -> Score -> Rank -> Deduplicate -> Paginate -> Response`

## Required mappings
F01 candidate contract; F02 source selection; F03 eligibility; F04 ranking signals; F05 score/rank rules; F06 personalization inputs; F07 deduplication; F08 pagination/cursor stability; F09 search; F10 cache boundary; F11 freshness; F12 observability.

## Invariants
- Ranking cannot bypass visibility, authorization or entitlement rules.
- Results are deterministic for the same declared inputs and rule version where required.
- Pagination does not silently duplicate or lose items within a supported consistency window.
- Search and feed contracts remain separable from future ranking implementations.

## Exit gate
Feed/search/recommendation paths require contract, integration/E2E, performance and evidence gates. No claim of production readiness from unit tests alone.
