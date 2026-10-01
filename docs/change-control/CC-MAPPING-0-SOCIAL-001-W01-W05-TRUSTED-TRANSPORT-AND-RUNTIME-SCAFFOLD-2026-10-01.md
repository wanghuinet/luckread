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
W01→W02 actor AccountState read = IMPLEMENTED / REMOTE_NOT_VERIFIED
W01→W05 Like trusted transport = CONTRACTED / IMPLEMENTED / REMOTE_NOT_VERIFIED
W05 Follow runtime = IMPLEMENTED / UNIT_VERIFIED
D1-02 migration = PREVIOUSLY EXECUTED
Public policy admission = BLOCKED
Actor AccountState authority = BOUND_TO_W02 / REMOTE_NOT_VERIFIED
Remote runtime E2E = REQUIRED
SOCIAL-001 = NOT_GREEN

## Policy-authority gap before public success

The W01→W05 runtime envelope currently contains policy facts, but those facts are admission inputs only and are not client-authoritative.

Required authority bindings/evidence:
1. Actor account state → W02 authoritative account/access state.
2. Target followability, privacy scope and block relationship → canonical Social/Profile authority must be identified and transport-bound; no W01 inference.
3. Anti-abuse admission → canonical anti-abuse decision source must be identified and transport-bound.
4. Like resource visibility/interactability → Content authority must expose an admitted trusted decision source before Like becomes public.
5. Like actor AccountState → W02 authoritative account/access state; W01 is the composition boundary and does not accept caller-provided account state.
5. W05 remains the sole mutation authority for Follow/Like in D1-02; policy sources do not become write owners.

Until these are bound and remotely evidenced, W01 must not expose successful public Follow/Like mutation based on caller-supplied policy fields.
