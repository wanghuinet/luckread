# W05 — Social / Community / Messaging / Notification

Canonical Worker identity: **W05**
Canonical responsibility: **Social / Community / Messaging / Notification**
Primary Tasks: **T11, T12, T13, T14**
Production database runtime: **Neon PostgreSQL D1-02** for W05 social data and **Neon PostgreSQL D1-03** for the scoped W09-owned push endpoint registry. No Cloudflare D1 binding is declared in the production Wrangler config.
- Scoped D1-03 write delegation: W09 owns `notification_push_endpoints` and its schema migration; W05/T14 may only register/delete the current user's Expo routing endpoint. W05 does not own the D1-03 migration directory.
- Scoped D1-03 entity: `notification_push_endpoints` (Expo routing endpoints only; separate `migrations-d1-03/` directory).

Canonical repository path: `workers/W05-social`.

Current boundary:
- Social/community relationship and interaction work belongs to W05 under approved Contracts and Mapping.
- Transaction / monetization authority belongs to W07 / D1-04.
- No unrestricted cross-D1 writes.
- No business implementation is admitted solely by directory presence.

Any new W05 runtime capability requires the applicable Task, Contract, Mapping, authorization, tests, and Evidence gates.

Neon D1-02 runtime closure:
- W05 social HTTP routes compose PostgreSQL stores through the shared D1-02 Hyperdrive pool, including owner-scoped reply-audience policy reads and writes.
- The scheduled notification workflow composes W05-owned push outbox, delivery-claim, send-result and receipt stores from that same D1-02 pool.
- `notification_push_endpoints` remains owned by W09 in the D1-03 logical domain. W05 uses the separate `HYPERDRIVE_D1_03` Neon pool for endpoint registration/deletion and token invalidation; the D1-02 pool is never used for this table.
- `src/entry.ts` injects the complete Neon social-store composition and the separately scoped D1-03-domain endpoint executor. Production explicitly selects Neon and carries no Cloudflare D1 connection bindings. The scheduled push workflow requires explicit Neon outbox/delivery/receipt stores plus the W09-owned Neon endpoint access store; this path has no D1 fallback. Repost, Share and Profile Pin route/runtime paths require their injected Neon Stores and fail closed when missing. Other W05 social HTTP routes still have separate D1-compatible paths and are tracked as remaining cleanup. Block/Mute relation/list and Relationship Graph runtimes now also require injected PostgreSQL Stores and fail closed when composition is absent. Notification Preferences GET/PATCH now also require the injected Neon PostgreSQL Store and fail closed when it is absent. Notification enqueue is now PostgreSQL Store-only; D1 enqueue adapter/fallbacks are removed while notification delivery remains a best-effort side effect. Comment reply/like notification context now requires the injected PostgreSQL Store; its D1 adapter and runtime fallback are removed, and missing composition fails closed before the comment/like mutation. Social Token Sync and Social Closure Read now require the injected PostgreSQL Store; their D1 adapters and route fallbacks are removed. Topic discovery, topic pages, notification inbox/read state, social summaries, and immutable mention/topic target reads share the same Neon PostgreSQL closure Store. Other W05 social HTTP routes still have separate D1-compatible paths and remain tracked for later cleanup.


Comment list reads now require the injected Neon PostgreSQL Store and fail closed when composition is absent. The D1 query dialect, adapter, and `env.DB` fallback have been removed; pagination, relevant/recent/liked ordering, viewer block/mute filtering, published-comment visibility, mention identity, and viewer like state remain covered by Store-port tests and PostgreSQL adapter tests.

## W05 Following-feed Author Read

- Following-feed author candidates now require the explicitly injected Neon PostgreSQL `FollowingAuthorIdsReadStore`; missing composition returns 503 and never falls back to `env.DB`.
- Removed the D1 query executor and `createD1FollowingAuthorIdsReadStore` adapter.
- Preserved the bounded 500-author candidate window, author-ID-only contract, bidirectional Block exclusion, viewer-directed Mute exclusion, deterministic ordering, and W03 authority over published content selection.
- Runtime and route tests use Store fixtures; PostgreSQL adapter tests continue to verify the SQL semantics.

## W05 Follower / Following List Read

- Follower and following list routes now require the explicitly injected Neon PostgreSQL `FollowListReadStore`; missing composition returns 503 and never falls back to `env.DB`.
- Removed `FollowListD1Database` and `createD1FollowListReadStore`; the PostgreSQL adapter is the only production database implementation for this read path.
- Preserved public-read transport policy, bidirectional Block filtering, deterministic timestamp/relationship cursor pagination, bounded page size, separate filtered aggregate count, and count-cache behavior.
- Runtime and route tests use Store fixtures; PostgreSQL adapter tests continue to verify SQL behavior.

## W05 Follow / Unfollow Write

- Follow and Unfollow mutation routes now require the explicitly injected Neon PostgreSQL `FollowStore`; missing composition returns 503 and never falls back to `env.DB`.
- Removed `createD1FollowStore`; the PostgreSQL adapter is the only production database implementation for these mutations.
- Preserved atomic bidirectional Block guard, existing-relationship identity/timestamp, idempotent Unfollow, relationship-graph cache invalidation, and best-effort notification enqueue.
- Follow status read remains a separately tracked D1 cleanup item; this slice does not make all W05 follow functionality Neon-only.

## W05 Follow Status Read

- The internal Follow Status helper now accepts only the injected Neon PostgreSQL `FollowStatusReadStore`; the D1 adapter and runtime fallback are removed.
- The helper is currently used by the Neon PostgreSQL rehearsal and focused runtime tests, not by a public production route; this change does not claim a user-facing endpoint migration.
- Preserved missing-relationship false status, either-direction Block suppression, and sanitized storage failure mapping.


## W05 Like Status Read

- Removed the D1 like-status query executor and `createD1LikeStatusReadStore`; the runtime no longer constructs a status reader from the legacy database argument.
- Like status and aggregate reads now require the injected Neon PostgreSQL `LikeStatusReadStore` on cache misses; missing composition fails closed with 503.
- Preserved W03 published-content validation, W05 Block preflight ordering, viewer-state and aggregate cache behavior, bounded safe counts, and the existing PostgreSQL adapter/rehearsal coverage.
- This slice removes only the like-status query adapter; like mutation and like-target context D1 paths remain separate cleanup items.


## W05 Like / Unlike and Like Target Context

- Removed the D1 like-mutation adapter and D1 target-context/Block-preflight adapter.
- Like, Unlike, and Like Status runtime paths now accept explicit Store ports only; Like/Unlike routes fail closed with 503 when required Neon Stores are not composed.
- The Neon runtime composes the existing PostgreSQL mutation and target-context Stores. No route passes `env.DB` into the Like runtime.
- Preserved W03 published-content authority, published-comment checks, bidirectional Block preflight, final PostgreSQL guarded Like insert (including W03 parent owner for comment likes), idempotent Like/Unlike behavior, sanitized storage errors, and viewer/aggregate cache invalidation.
- This is one Like business slice; it does not mean all W05 routes or the W05 Worker are D1-free.


## W05 Favorite / Unfavorite and Favorite Status / List

- Removed the D1 adapters for favorite mutation, favorite status reads, and actor-scoped favorite list reads.
- The Favorite runtime now accepts only the three Store ports; it no longer resolves D1-or-Store sources or constructs default D1 adapters.
- Favorite, Unfavorite, Favorite Status, and Favorite List routes require their injected Neon PostgreSQL Stores and fail closed with sanitized 503 when composition is missing.
- Preserved W03 publication validation before writes and reads, unpublished-content cache invalidation/false status, actor-scoped idempotent favorite upsert, idempotent removal, bounded keyset pagination with exact microsecond cursor precision, and status-cache invalidation after mutations.
- Existing PostgreSQL adapters, SQL tests, and rehearsal composition remain unchanged. This closes the Favorite business slice only, not all W05 D1-compatible routes.


## W05 Poll lifecycle (configuration, read, vote and draft deletion)

- Removed the D1 adapters from the Poll configuration, read, vote and draft-delete Store modules.
- Poll runtime APIs now accept explicit Store ports only; no D1 default Store construction or D1 database parameter remains in the poll runtime.
- Poll GET requires the Neon read Store; poll POST requires configuration + read Stores; vote POST requires vote + read Stores; draft DELETE requires the delete Store. Missing composition returns 503.
- Preserved W03 published/owned-post validation, owner-only draft preview and configuration, bidirectional Block filtering, option and duration validation, publication-based lazy expiry, vote aggregation and viewer choice, one-vote idempotency, closed-poll enforcement, and protection against deleting/reconfiguring polls after votes exist.
- Existing PostgreSQL adapters, SQL tests and local PostgreSQL 18 rehearsal scripts remain the storage verification path.
- This closes the Poll business slice only. Other W05 routes may still have separate legacy D1 adapters/fallbacks.
