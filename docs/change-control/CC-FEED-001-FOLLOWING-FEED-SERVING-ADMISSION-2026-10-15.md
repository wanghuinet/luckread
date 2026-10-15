# CC-FEED-001-FOLLOWING-FEED-SERVING-ADMISSION-2026-10-15

## Status

`PROPOSED / IMPLEMENTATION_NOT_AUTHORIZED`

This change-control proposal requests admission for one bounded Following-feed serving slice. It does not claim that FEED-001 is implemented or green, and it does not authorize deployment.

## Trigger and verified current state

The Twitter Clone-style homepage currently links the Following tab to `/me/following`, which is the relationship-list page rather than a content timeline. `TwitterCloneHomeFeed` reads `/api/v1/contents` and does not filter by the authenticated viewer's follow graph.

The repository's current feed operation policy marks `getFollowingFeed` / `GET /feed/following` as `MISSING`. The FEED-001..013 real-evidence reconciliation marks FEED-001 `BLOCKED_NOT_GREEN` and explicitly states that implementation authorization is false. The W04 runtime currently exposes `GET /health` and consumes `identity.account_state_changed`; its README states that user-facing Feed/Recommendation/Search APIs are not implemented in this slice.

Verified source locations:
- `workers/W01-payload/src/app/(twitter-clone)/home/page.tsx`
- `workers/W01-payload/src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx`
- `workers/W01-payload/wrangler.jsonc`
- `workers/W04-feed-search/src/index.ts`
- `workers/W04-feed-search/wrangler.jsonc`
- `contracts/api/feed-operation-policy.v1.json`
- `contracts/alignment/mapping-batches/FEED-001-013-real-evidence-reconciliation.v1.md`
- `docs/change-control/CC-MAPPING-0-AUTH-013-FEED-SEARCH-SERVING-GAP-2026-10-04.md`

## Proposed scope

Admit FEED-001 only, with chronological ordering as the initial policy. Do not implement ranking, trends, search, recommendation, repost entries, or any other feed feature in this slice.

The user-visible outcome is:
1. A signed-in viewer opens Following and receives published content from accounts they currently follow.
2. The initial page and subsequent pages use an opaque, stable cursor and a bounded page size (maximum 50).
3. Empty follows produce a deliberate empty state.
4. Anonymous requests fail closed and redirect through the existing login return path.
5. Block/mute, account state, content visibility, deletion/moderation, and published-state rules are enforced server-side before emission.
6. For You remains on the existing content-list source until a separate admitted slice changes it.

## Authority and topology constraints

- W01 remains the public API/authentication boundary and must derive viewer identity from the existing verified session, never from client-supplied identity.
- W04 remains the feed-serving/projection boundary and must not become an authoritative content or social store.
- W05 remains authoritative for follow/block/mute relationships.
- W03 remains authoritative for content records and publication state.
- No new Worker, D1 database, Payload collection, or direct W01-to-D1 business query.
- Do not reuse `AUTH013_W04_DERIVED_PROJECTION` for feed data; its current purpose is the account-state projection.
- Do not make one content RPC per followed account or merge arbitrary client-side creator requests.
- Private feed cache keys must be viewer-scoped; no private timeline may enter a shared public cache.

## Required design decisions before implementation admission

The current evidence does not yet establish a complete bounded serving path. The following must be resolved in the admitted design before code is treated as ready:

1. Canonical public API path and operation ID, aligned across API inventory, OpenAPI, permission policy, and the existing W01 route tree.
2. Concrete W01→W04 and W04→W03/W05 service-binding contract, including trusted caller/principal provenance and fail-closed behavior.
3. An authoritative, bounded way to obtain the viewer's followed-user set and the W03 query/transport to retrieve a globally ordered content page for multiple creators without per-author RPC fan-out.
4. Cursor semantics under concurrent publication and follow/unfollow changes, including stable tie-breaking and tamper/expiry validation.
5. Server-side eligibility and block/mute/account-state enforcement before the final result is emitted.
6. Private-cache key, freshness, invalidation/version behavior, bounded rebuild, and single-flight strategy. The existing W04 account-state KV namespace must not be repurposed.
7. Resource/RPC/read-row budgets, anti-abuse limits, timeouts, and graceful failure behavior.
8. Positive and negative integration tests, pagination/concurrency tests, cache-isolation tests, and deployed HTTP evidence.

## Admission and acceptance gates

Implementation must remain unauthorized until reviewers admit the canonical API/DTO/transport decisions and the serving-path design above. After admission, the code change should be a separate, narrowly scoped implementation PR.

The implementation PR must not be marked complete until all of the following pass:
- W01 and W04 typecheck/lint/build and relevant worker workflows.
- Authenticated positive-path test proves only followed authors' eligible content appears.
- Anonymous and malformed-cursor requests fail closed with the canonical error envelope.
- Unfollow, block/mute, restricted/deleted/unpublished content do not leak into results.
- Cursor pages are bounded, ordered, deduplicated, and do not repeat items under concurrent insertion.
- Private cache isolation is proven across two distinct users.
- Service-binding failure returns a bounded safe error and does not fall back to the generic public contents list.
- The Twitter Clone UI reuses the existing feed card and pagination presentation; no parallel CSS system is introduced.
- Runtime/CI evidence is attached to the validating commit SHA.

## Non-goals

This proposal does not implement the Following feed, change current production routing, alter any D1 schema, provision new infrastructure, deploy W04/W01, or promote FEED-001 to GREEN.

## Additional verified implementation facts (2026-10-15)

The existing building blocks are real but not sufficient to claim a Following timeline:

- `workers/W05-social/src/follow-runtime.ts` already implements bounded follow-list pages (maximum 50) with deterministic `created_at DESC, relationship_id DESC` ordering, a user/direction-scoped cursor, and direct block filtering. Its cursor is Base64-encoded JSON with structural validation, not a cryptographically signed cursor; the new feed cursor must not inherit that assumption without an integrity design.
- `workers/W05-social/src/index.ts` accepts the current internal social caller marker only when `X-LuckRead-Caller: W01`; the admitted follow transport also names W01 as its caller.
- `workers/W03-content/src/index.ts` currently handles `GET /internal/content/contents` with a singular `creatorId` filter, not a canonical multi-creator Following-feed query.
- `contracts/transport/W01-W03-content-http-binding.v1.json` and `contracts/transport/W01-W05-social-follow-http-binding.v1.json` define current W01 caller provenance. The public W01 Worker config binds W03 and W05, while `workers/W04-feed-search/wrangler.jsonc` currently has only the account-state KV projection and Queue consumer; it has no W03/W05 service bindings.
- The public follow-list W01 adapter can read one user's following list through W05, but that list API is not itself a global multi-author content timeline.

These findings are why merely linking the tab to `/api/v1/users/{userId}/following`, repeatedly querying `/api/v1/contents?creatorId=...`, or copying W01's caller marker from W04 would be incorrect.

## Recommended architecture for the admission decision (proposal only)

Prefer the contract's W04 feed-serving boundary, without adding a Worker or D1:

1. W01 exposes the canonical authenticated public route `GET /api/v1/feed/following?cursor=&limit=`; it resolves the viewer through the existing W02-backed server principal and forwards no end-user bearer/session token to downstream Workers.
2. W01 calls W04 through a private Service Binding with a transport contract that carries server-derived viewer identity, correlation ID, page size and cursor. W04 must reject direct/public invocation and malformed/untrusted context.
3. W04 obtains follow candidates from W05 and eligible content candidates from W03 using explicit read-only, bounded, feed-specific internal operations. Admission must define the W04 caller identity and transport contract; do not weaken existing W01-only operations or let W04 impersonate W01.
4. The W03 operation must provide a single bounded multi-creator query with stable global ordering and owner/state/visibility checks, rather than one RPC per followed creator. W05 remains authoritative for the relationship set and block/mute eligibility; W03 remains authoritative for content and publication state; W04 only assembles the derived feed.
5. Before admitting implementation, resolve how complete follow-graph coverage is maintained beyond one 50-item follow-list page and how follow/unfollow changes affect the cursor. A fixed list of only the most recent followed accounts is not acceptable as a complete Following feed.
6. Use an integrity-protected, versioned feed cursor bound to viewer identity and query dimensions. Private caching must be per-viewer, no-store must be the safe fallback, and the existing AUTH-013 account-state KV namespace remains dedicated to that projection.

This path requires explicit approval for feed-specific W01→W04 and W04→W03/W05 transport operations, plus a bounded W03 multi-creator read model/query. Those are the design items to admit before implementation; they are not existing capabilities.

## Next implementation admission checklist

A reviewer can admit this slice only after the PR/contract set identifies:
- canonical route and operation ID;
- typed request/response DTO and error envelope;
- W01→W04 and W04→W03/W05 caller identity, trusted principal provenance, timeout and failure mapping;
- bounded follow-graph retrieval that does not silently omit followed creators;
- one bounded multi-creator content query and stable, integrity-protected pagination;
- explicit account-state, block/mute, moderation, deleted/unpublished and visibility filtering;
- per-viewer cache strategy and unfollow/block invalidation/freshness behavior;
- max response rows, candidate rows, RPC count, D1 read rows, CPU, rate limits and concurrent request behavior.

Until those decisions are admitted, keep this PR Draft and keep FEED-001 `BLOCKED_NOT_GREEN`.
