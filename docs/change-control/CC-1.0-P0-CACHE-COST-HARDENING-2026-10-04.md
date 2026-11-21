# Change Control — 1.0 P0 Cache Cost Hardening — 2026-10-04

Status: MERGED / RELEVANT-CI-VALIDATED / RUNTIME-EVIDENCE-PENDING

## Baseline

- authoritative main before slice: `19bd75423930a3776178251fcc9384c78fdb5369`
- backup: `backup/2026-10-04-pre-cache-cost-hardening`
- working branch: `superpowers/1.0-cache-cost-hardening`
- merged main: `36e9f5ad8cf059bf394d7010d2ce631774f232fd`
- pull request: #645

## Scope

This change closes three concrete 1.0 public-read cost risks found by current-head audit:

1. attacker-controlled unknown query parameters creating unbounded cache-key cardinality on username lookup;
2. public media metadata bypassing the shared response cache;
3. repeated cache misses re-entering the authoritative origin without a per-key bounded miss budget.

The same slice also enables a bounded 10-second negative cache for public 404 JSON responses.

## Non-Goals

- no new Worker;
- no new D1;
- no change to Payload authority;
- no change to D1 ownership;
- no read/write split by adding infrastructure;
- no promotion of Mapping 0 or Evidence Registry.

## Implementation

### Cache key hardening

- `user-profile-by-username` has an explicit empty query allowlist.
- `media-detail` has an explicit empty query allowlist.

Unknown query parameters therefore cannot create a new cache key for these fixed-resource public reads.

### Public media cache

`GET /api/v1/media/:mediaId` now executes through `cachedPublicGet(..., 'media-detail', ..., 30)` after the existing public edge rate limit.

Payload Media remains the authority. The cache stores only the projected public metadata response.

### Cache-miss origin fuse

The shared public cache now maintains a bounded per-isolate miss history:

- 5 origin misses per canonical cache key per 60 seconds;
- 1,024 tracked keys maximum;
- the fuse runs before the authoritative loader;
- a fuse rejection returns 503 with retry hint instead of entering origin;
- successful mutation invalidation clears both cached value and the affected miss budget.

The existing Cloudflare public-read/location rate limits remain the broader protection against high-cardinality attacks across isolates.

### Negative cache

Public JSON 404 responses may be cached for at most 10 seconds. The shorter TTL prevents repeated lookup of nonexistent resources without retaining stale not-found decisions for a long period.

## CI Evidence

The merged PR #645 exact head `7a6e39e3db390b1aea1e988c5bd2ef60df13dd1b` produced:

- 1.1 P0 Cache Hardening CI: run `37180120328` — PASS
- 1.0 D1 Traffic Guard Contract CI: run `37180120286` — PASS
- Worker D1 Access Boundary Gate: run `37180120291` — PASS
- Worker Directory Drift Gate: run `37180120275` — PASS
- Security Hardening Gate: run `37180120294` — PASS
- Mapping 0 Structural Gate: run `37180120293` — PASS
- Worker Terminal Routing Gate: run `37180120296` — PASS
- Payload Implementation Admission: run `37180120278` — PASS
- W05 Social Runtime CI: run `37180120269` — PASS
- Contract Admission CI: run `37180120281` — PASS
- W01 Auth Me Import Verification: run `37180120323` — PASS
- W01 Creator Center Admin Verification: run `37180120303` — PASS
- W01 Homepage E2E: run `37180120262` — PASS

Payload Foundation CI run `37180120302` remained a pre-existing W01 baseline lint failure outside the cache slice. It is not reclassified as a cache defect and is not represented as GREEN evidence for this Change Control.

## Acceptance

The scoped cache and D1-guard acceptance checks passed in CI. No production runtime claim is made here until independent deployment/runtime evidence is recorded.
