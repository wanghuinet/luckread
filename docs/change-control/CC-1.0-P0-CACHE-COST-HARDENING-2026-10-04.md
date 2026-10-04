# Change Control — 1.0 P0 Cache Cost Hardening — 2026-10-04

Status: IMPLEMENTATION_SLICE / AWAITING CI EVIDENCE

## Baseline

- authoritative main: `19bd75423930a3776178251fcc9384c78fdb5369`
- backup: `backup/2026-10-04-pre-cache-cost-hardening`
- working branch: `superpowers/1.0-cache-cost-hardening`

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

## Acceptance

Required CI evidence:

- public cache unit tests pass;
- cache miss single-flight remains intact;
- repeated cache failure triggers bounded fuse without invoking origin after the limit;
- username lookup cache key ignores attacker-controlled query parameters;
- media metadata route is cache-first;
- negative cache is bounded to 10 seconds;
- W01 typecheck passes;
- existing 1.0 D1 Traffic Guard CI remains compatible.

No production runtime claim is made by this Change Control until deployment/runtime evidence is independently recorded.
