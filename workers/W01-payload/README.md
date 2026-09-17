# W01 — Platform / Payload

Role: Payload 二开基座（Platform / Payload Core）。

Locked boundary:
- Payload Core / Admin / core runtime
- Payload configuration and supported extension points
- Payload D1 adapter integration
- Payload migration/runtime integration

Current source-of-truth remains under `src/` until Mapping is GREEN. Do not duplicate or independently implement Payload runtime here before the migration gate is approved.

Post-Mapping-GREEN transition:
1. Move the verified Payload runtime files into W01.
2. Reconcile all scripts, tsconfig aliases, CI, tests, and contract evidence paths in one change-controlled batch.
3. Preserve `payload.config.ts`, D1 adapter semantics, `push: false`, and migrationDir behavior.
