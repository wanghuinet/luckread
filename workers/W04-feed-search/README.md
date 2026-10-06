# W04 — Feed / Recommendation / Search

Canonical Worker identity: **W04**
Canonical responsibility: **Feed / Recommendation / Search**

Physical Worker:
- Name: `luckread-w04`
- Entrypoint: `src/index.ts`

This bootstrap slice establishes the physical Worker resource and the existing account-state projection consumer.

Boundaries:
- No D1 binding.
- No authoritative business-state storage.
- No public API redesign.
- Consumes the existing `identity.account_state_changed` event.
- Stores only derived account-state projection state in the existing W04 KV binding.
- Projection application is idempotent by source version and deindexes restricted account states.
- Feed / recommendation / search business APIs are intentionally not implemented in this slice.

The next business slice should extend the existing projection boundary only; it must not promote W04 into an authoritative identity/content store.
