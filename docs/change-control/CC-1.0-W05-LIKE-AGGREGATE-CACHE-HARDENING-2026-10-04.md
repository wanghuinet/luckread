# Change Control — W05 Like Aggregate Cache Hardening — 2026-10-04

Status: IMPLEMENTATION_SLICE / AWAITING CI EVIDENCE

## Baseline
- authoritative main: `36e9f5ad8cf059bf394d7010d2ce631774f232fd`
- backup: `backup/2026-10-04-pre-w05-counter-read-hardening`
- working branch: `superpowers/w05-counter-read-hardening`

## Gap
W05 `getLikeStatus` currently combines viewer-specific like state with a target-wide `COUNT(*)`. Its 5-second cache key contains the actor, so the public aggregate is duplicated across viewers and hot content can repeatedly re-enter D1.

## Decision
- Keep authoritative like relationships in `interaction_likes` (D1-02).
- Keep viewer-specific `liked` state in a private actor/target cache.
- Store target-wide `likeCount` in a separate shared cache key.
- Shared aggregate cache TTL is 5 seconds and may be stale for at most that cache interval.
- Viewer-state invalidation remains immediate on like/unlike.
- Shared aggregate cache is intentionally not synchronously invalidated by every like/unlike; expiry bounds staleness and avoids turning high-frequency mutations into synchronous cache fan-out.
- No new Worker, D1, table, queue, or authoritative field.

## Non-goals
- No persistent follower/like counter projection.
- No change to authorization or interaction authority.
- No change to public API shape.
- No Mapping 0 promotion.

## Acceptance
- A cached viewer state can be reused without D1.
- A cached target aggregate avoids `COUNT(*)` on subsequent viewers during the TTL.
- When aggregate cache is warm, D1 status lookup does not contain `COUNT(*)`.
- Like/unlike invalidates viewer state but does not force a synchronous aggregate refresh.
- Existing block/visibility rules remain authoritative.
