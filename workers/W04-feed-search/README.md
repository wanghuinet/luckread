# W04 — Feed / Recommendation / Search

Canonical Worker identity: **W04**
Canonical responsibility: **Feed / Recommendation / Search**

Physical Worker:
- Name: `luckread-w04`
- Entrypoint: `src/index.ts`

This bootstrap slice establishes the physical Worker resource only.

Boundaries:
- No D1 binding.
- No authoritative business-state storage.
- No public API redesign.
- No `identity.account_state_changed` consumer implementation yet.
- No projection/deindex business behavior yet.

The next implementation slice is the minimum admitted projection/deindex consumer under the existing W04 GAP Change Control.
