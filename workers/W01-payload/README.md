# W01 — Platform / Payload

Role: Payload 二开基座（Platform / Payload Core）。

Locked boundary:
- Payload Core / Admin / core runtime
- Payload configuration and supported extension points
- Payload D1 adapter integration
- Payload migration/runtime integration

Baseline:
- Runtime baseline is the official Payload `templates/with-cloudflare-d1` structure.
- The verified baseline source has been physically materialized under `workers/W01-payload/src/`.
- The W01 dependency baseline follows the official Cloudflare D1 template structure recorded in `PAYLOAD-CLOUDFLARE-D1-UPSTREAM-MANIFEST.md`; the current W01 lock is Payload 3.87.1 per `workers/W01-payload/package.json`, while 3.82.1 remains only the historical upstream template observation.
- W01 must not substitute a standard Payload release line for the Cloudflare template baseline.

Governance:
- Physical materialization does not by itself make Mapping 0 GREEN.
- Contract / Mapping / Runtime / Evidence gates remain independently verifiable.
- Existing LuckRead contracts and business rules must not be overwritten by upstream template content.
- `payload.config.ts`, D1 adapter semantics, migrationDir behavior, and the locked runtime constraints require explicit reconciliation before implementation is considered closed.

Next gate:
1. Reconcile remaining W01 runtime files and scripts against the official Cloudflare D1 template.
2. Reconcile Payload app routes, admin runtime, collections, migrations, and generated types.
3. Run dependency installation plus lint/type/build/test validation where environment permits.
4. Record runtime/schema evidence and reconcile the AUTH-002 evidence contracts that still encode the former 3.82.1 upstream observation as the current baseline.
5. Perform the Mapping 0 reverse-coverage check.
6. Only then can the relevant gate be marked GREEN.
