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
- `src/entry.ts` injects the complete Neon social-store composition and the separately scoped D1-03-domain endpoint executor. Production explicitly selects Neon and carries no Cloudflare D1 connection bindings. The scheduled push workflow requires explicit Neon outbox/delivery/receipt stores plus the W09-owned Neon endpoint access store; this path has no D1 fallback. Repost, Share and Profile Pin route/runtime paths require their injected Neon Stores and fail closed when missing. Other W05 social HTTP routes still have separate D1-compatible paths and are tracked as remaining cleanup. Block/Mute relation/list and Relationship Graph runtimes now also require injected PostgreSQL Stores and fail closed when composition is absent. Notification Preferences GET/PATCH now also require the injected Neon PostgreSQL Store and fail closed when it is absent. Notification enqueue is now PostgreSQL Store-only; D1 enqueue adapter/fallbacks are removed while notification delivery remains a best-effort side effect.
