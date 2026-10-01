# Change Control: SOCIAL-001 W01→W05 Trusted Transport and Runtime Scaffold — 2026-10-01

- Status: BOUNDED_SCAFFOLD / NOT_GREEN
- Scope: SOCIAL-001 Follow/Unfollow
- Canonical ownership: SOCIAL → T11 → W05 → D1-02

## Allowed
1. Add the existing W01 service-binding pattern for W05_SOCIAL.
2. Add a private W01 client using only the trusted envelope.
3. Add the W05 internal Follow/Unfollow mutation handler.
4. Reuse the already executed social_follow_relationships D1-02 migration.
5. Add deterministic unit tests.

## Forbidden
- No public route success until trusted policy authorities are bound.
- No client-authoritative actor/account/policy/counter state.
- No new Worker, D1 or idempotency store.
- No synchronous downstream fan-out.
- No Evidence Registry VERIFIED/PASS claim from unit tests alone.
- No Mapping 0 GREEN claim.

## Gate
W01→W05 binding = CREATED / NOT_REMOTE_VERIFIED
W05 Follow runtime = IMPLEMENTED / UNIT_VERIFIED
D1-02 migration = PREVIOUSLY EXECUTED
Public policy admission = BLOCKED
Remote runtime E2E = REQUIRED
SOCIAL-001 = NOT_GREEN
