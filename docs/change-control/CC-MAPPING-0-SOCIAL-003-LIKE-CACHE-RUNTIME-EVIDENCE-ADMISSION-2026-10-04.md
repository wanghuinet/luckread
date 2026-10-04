# CC-MAPPING-0-SOCIAL-003 Like Aggregate Cache Runtime Evidence Admission — 2026-10-04

## Status

EVIDENCE_RECONCILED / FEATURE_NOT_GREEN

## Scope

This control admits the completed W05 Like Aggregate Cache Runtime E2E as current evidence for the SOCIAL-003 like/reaction capability.

This is an evidence-admission control only.

- No production cache implementation change.
- No new Worker, D1, table, queue, counter, or API shape.
- No promotion of SOCIAL-003 to GREEN.
- No promotion of Mapping 0 or the canonical Evidence Registry to GREEN.

## Runtime Evidence

- Workflow: W05 Like Aggregate Cache Runtime E2E
- Run: https://github.com/wanghuinet/luckread/actions/runs/37194522154
- Job: 111413499684
- Artifact: w05-like-cache-runtime-e2e-016c0aa7bbc84c341fb456bda45653b824b3c402-37194522154
- Artifact ID: 11300670380
- Exact deployed W05 source: 016c0aa7bbc84c341fb456bda45653b824b3c402

The run completed successfully and generated the complete runtime evidence set:

- like-initial.json
- like-aggregate-fresh-stale.json
- like-aggregate-refresh.json
- like-viewer-invalidation.json
- like-shared-prime.json
- like-shared-no-sync-invalidation.json
- like-shared-refresh-2.json
- provenance.json

## Observed Acceptance Results

1. Initial viewer state was liked=false, aggregate likeCount=0.
2. A second authoritative like was introduced outside the API while the shared aggregate remained fresh; the observed aggregate stayed at 0 within the 5-second TTL.
3. After TTL expiry, the aggregate refreshed to authoritative count 1.
4. The API like mutation changed viewer-specific state to liked=true without requiring synchronous shared-aggregate invalidation.
5. The shared aggregate was explicitly primed at authoritative count 2 immediately before the non-invalidation assertion.
6. A third authoritative like was inserted directly into D1; the shared aggregate continued to return 2 immediately after the mutation.
7. After the second TTL interval, the shared aggregate refreshed to authoritative count 3.
8. Synthetic viewer/content fixtures were cleaned up successfully.

These results match the approved Change Control decision in CC-1.0-W05-LIKE-AGGREGATE-CACHE-HARDENING-2026-10-04 and the interaction-operation-policy.v1.json cache semantics.

## Freshness / Inheritance

The runtime evidence was executed against W05 source 016c0aa7bbc84c341fb456bda45653b824b3c402.

A repository comparison against current main 4ebb096271842a4109690056496b330bf472bec7 shows:

- 7 commits after the tested source;
- exactly one changed path: .github/workflows/w05-like-cache-runtime-e2e.yml;
- no changes to workers/W05-social/src/like-runtime.ts;
- no changes to the W05 like migration or production runtime implementation in that interval.

Therefore the runtime evidence is admitted with:

- freshnessMode = INHERITED_UNCHANGED_SCOPE
- inheritanceRef = docs/change-control/CC-MAPPING-0-SOCIAL-003-LIKE-CACHE-RUNTIME-EVIDENCE-ADMISSION-2026-10-04.md

## Registry Disposition

Canonical Evidence Registry record:

- evidenceId: EVD-SOCIAL003-LIKE-CACHE-RUNTIME-001
- result: PASS
- status: VERIFIED
- subject: SOCIAL-003
- tested source: 016c0aa7bbc84c341fb456bda45653b824b3c402
- workflow/job: 37194522154 / 111413499684

The record supports the SOCIAL-003 cache acceptance claims only. It does not satisfy the missing anti-abuse, state, integration-wide, or security-E2E claims for the whole feature, and it does not change the feature's existing non-GREEN state.

## Decision

The W05 Like Aggregate Cache runtime evidence is admitted and reconciled.

The following remain unchanged:

- Canonical Evidence Registry status: NOT_GREEN
- Canonical Mapping 0 status: NOT_GREEN
- SOCIAL-003 feature status: NOT_GREEN / PARTIAL
- Project-wide unresolved Mapping 0 inventory gaps remain governed separately

No further W05 Like Aggregate Cache runtime rerun is required for this evidence unit unless the production like/cache implementation or its contract semantics change.
