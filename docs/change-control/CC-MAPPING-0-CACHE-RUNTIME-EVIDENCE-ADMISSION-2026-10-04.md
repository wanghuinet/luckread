# Mapping 0 Cache Runtime Evidence Admission — 2026-10-04

## Status

EVIDENCE_RECONCILED / FEATURE_NOT_GREEN / MAPPING-0-NOT_GREEN

## Scope

This evidence-admission control records two completed production runtime proofs against the exact current W01 deployment source:

1. Content List cache boundary and mutation invalidation.
2. Media owner-scoped metadata boundary and no shared caching.

This control changes no production implementation and introduces no Worker, D1, queue, binding, API, authority, or schema.

## Runtime Evidence

### CONTENT-007 — Public List Cache Invalidation

- Deployment: https://github.com/wanghuinet/luckread/actions/runs/37195981263
- Runtime E2E: https://github.com/wanghuinet/luckread/actions/runs/37196089360
- Artifact: https://github.com/wanghuinet/luckread/actions/runs/37196089360/artifacts/11300637536
- Tested source: `0f0f7d52d8246f45413d5479e5c324365f7efcc5`
- Worker: `luckread-w01-payload`
- Public path: `/api/v1/contents`
- Namespace: `content-list`

Observed acceptance:
- anonymous filtered request MISS;
- repeated anonymous filtered request HIT;
- authenticated request bypassed shared cache;
- PUBLISHED→UNPUBLISHED mutation advanced the content-list generation;
- the old filtered cache variant became unreachable;
- the fixture was absent from the post-mutation response;
- cleanup completed successfully.

Registry record: `EVD-CONTENT007-PUBLIC-LIST-CACHE-RUNTIME-001`.

### MEDIA-001 — Owner-Scoped Metadata Cache Boundary

- Deployment: https://github.com/wanghuinet/luckread/actions/runs/37195981263
- Runtime E2E: https://github.com/wanghuinet/luckread/actions/runs/37196089353
- Artifact: https://github.com/wanghuinet/luckread/actions/runs/37196089353/artifacts/11301086936
- Tested source: `0f0f7d52d8246f45413d5479e5c324365f7efcc5`
- Worker: `luckread-w01-payload`
- Public path: `/api/v1/media/{mediaId}`

Observed acceptance:
- owner can read projected metadata;
- `Cache-Control: private, no-store`;
- no shared-cache header;
- `ownerUserId` excluded;
- projected fields only;
- non-owner = 404;
- anonymous = 403;
- cleanup completed successfully.

Registry record: `EVD-MEDIA001-OWNER-SCOPE-RUNTIME-001`.

## Admission Boundary

These records are current executable PASS evidence for their narrowly defined cache/runtime claims.

They do not:
- promote CONTENT-007 or MEDIA-001 to GREEN;
- promote the canonical Evidence Registry to GREEN;
- promote Mapping 0 to GREEN;
- satisfy unrelated API/entity/persistence/lifecycle/security claims.

The separate Cache Cost Hardening Change Control remains runtime-evidence-pending for the cache-miss origin fuse. Its existing CI/unit evidence is preserved and is not overstated by these records.

## Decision

Cache runtime evidence for the two completed slices is reconciled and admitted.

Canonical global status remains:
- Evidence Registry: NOT_GREEN
- Mapping 0: NOT_GREEN
