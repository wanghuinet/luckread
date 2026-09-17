# W01 — Platform / Payload

Role: Payload 二开基座（Platform / Payload Core）。

Locked boundary:
- Payload Core / Admin / core runtime
- Payload configuration and supported extension points
- Payload D1 adapter integration
- Payload migration/runtime integration

Baseline:
- Runtime baseline is the official Payload `templates/with-cloudflare-d1` structure.
- The verified baseline source has now been physically materialized under `workers/W01-payload/src/`.
- LuckRead remains on the currently locked Payload 3.87.1 dependency line; the upstream template's observed 3.82.1 package versions are reference-only and must not trigger a downgrade.

Governance:
- Physical materialization does not by itself make Mapping 0 GREEN.
- Contract / Mapping / Runtime / Evidence gates remain independently verifiable.
- Existing LuckRead contracts and business rules must not be overwritten by upstream template content.
- `payload.config.ts`, D1 adapter semantics, migrationDir behavior, and the locked runtime constraints require explicit reconciliation before implementation is considered closed.

Next gate:
1. Reconcile root runtime configuration and scripts against the upstream Cloudflare D1 template.
2. Reconcile Payload app routes, admin runtime, collections, migrations, and generated types.
3. Run lint/type/build/test validation where dependencies and environment permit.
4. Record evidence and perform the Mapping 0 reverse-coverage check.
5. Only then can the relevant gate be marked GREEN.
