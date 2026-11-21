# Change Control: SOCIAL-001 Follow Runtime Implementation Admission — 2026-09-30

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-FOLLOW-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-30`
- Status: `BLOCKED / AUTHORIZATION-PENDING`
- Repository authority: GitHub `main`
- Base main: `d1932602e7c3deeb96fca636c23ee1cb63c433ef`
- Latest reconciliation commit: `43c76445722a2dd8c79fabf2ff82dc5cebf99d64`
- Backups:
  - `backup/main-social-runtime-before-20260930`
  - `backup/main-social-admission-contract-before-20260930`
  - `backup/main-social-admission-cc-before-20260930`
- Feature: `SOCIAL-001`
- Entity: `ENT-SOCIAL-FOLLOW`
- Canonical ownership: `SOCIAL → T11 → W05 → D1-02`

## Purpose

Close the implementation-admission gap without introducing a runtime implementation that would bypass an authoritative authentication, account-state, privacy, block or scope boundary.

The Follow persistence chain is now physically verified:

```
SOCIAL-001
  ↓
ENT-SOCIAL-FOLLOW
  ↓
D1-02 binding verified
  ↓
Follow migration/schema verified
```

The remaining gate is the executable security/transport boundary required before W05 may mutate the authoritative Follow table.

## Current verified inputs

1. W05 is physically bound to the admitted D1-02 UUID.
2. `social_follow_relationships` and its contracted uniqueness/pagination indexes exist on D1-02.
3. Public operation IDs `follow` / `unfollow` and their DTO surface are already contracted.
4. The canonical interaction policy requires:
   - server-derived actor;
   - target resolved against authoritative User identity;
   - current account state;
   - target followability;
   - block/privacy/scope policy;
   - anti-abuse admission;
   - atomic uniqueness/concurrency semantics;
   - no synchronous downstream fan-out.

## Trusted admission-input contract

The missing security-input shape is now explicitly contracted at:

`contracts/transport/SOCIAL-001-follow-trusted-admission-input.v1.json`

The contract is intentionally `BLOCKED_NOT_ADMITTED`. It names the required server-only inputs and, for each currently unavailable policy input, records `MISSING_AUTHORITY_BINDING`.

This prevents a W05 implementation from silently treating client input, cache state, a D1-02 copy, or an ad-hoc cross-Worker call as authorization authority.

## Blocking gap

The current W05 runtime contains only the bootstrap health response and has no admitted Follow business handler.

The repository still lacks a single evidence-bound authority chain that supplies W05 with all required trusted security inputs while preserving the frozen topology and operation budgets.

Outstanding authority bindings are:

- actor account-state decision;
- target followability decision;
- block-policy decision;
- privacy/scope decision;
- anti-abuse admission;
- trusted W01→W05 caller provenance.

The existing W01 → W02 session path proves authenticated session authority, but it is not itself a Follow authorization decision and must not be silently repurposed as one.

## Budget / topology constraint

The Follow operation policy fixes:

- `d1ReadMax = 1`
- `d1WriteMax = 1`
- `rpcMax = 0` for the authoritative mutation operation
- distributed transactions are forbidden.

Therefore the implementation must not solve the missing policy by adding ad-hoc W05 → W02/W06 RPCs, cross-D1 reads, a second user store, or a new Worker.

No Worker, D1 database, Payload Collection, authoritative projection table, or public operation is authorized by this Change Control.

## Implementation admission rule

W05 Follow/Unfollow implementation may be admitted only after a Contract/Transport slice explicitly binds the trusted inputs above to the existing frozen topology.

The eventual runtime slice must:

1. derive `followerUserId` from a server-authenticated principal, never the request body;
2. accept only the contracted `targetUserId`;
3. fail closed when caller provenance or authorization admission is absent;
4. perform the contracted D1-02 relation mutation with the existing unique pair constraint;
5. preserve duplicate-follow and missing-unfollow idempotency;
6. avoid synchronous event fan-out and avoid adding a second relation/idempotency store.

## CI evidence on current reconciliation commit

The new admission-input contract triggered the existing repository gates on `43c76445722a2dd8c79fabf2ff82dc5cebf99d64`.

Observed runs:

- Mapping 0 Structural Gate: run `36720599134` — `success`
- AUTH-013 Persistence Schema Evidence: run `36720599310` — `success`

These are structural/evidence checks only and do not promote SOCIAL-001 or authorize runtime implementation.

## Explicit non-actions

- No Follow runtime handler is added by this Change Control.
- No W01 → W05 Service Binding is added by this Change Control.
- No W02/W06 endpoint is invented by this Change Control.
- No D1-02 projection of User/block/privacy authority is invented.
- No Mapping 0 GREEN is claimed.
- No Evidence Registry PASS is claimed.

## Decision material

The next contract-first slice is:

```
Trusted Follow Admission Authority Binding
  ↓
W01 authenticated principal + target/policy admission
  ↓
W05 trusted internal request boundary
  ↓
W05 Follow/Unfollow runtime
  ↓
positive / negative / concurrency / security evidence
```

The admission contract must explicitly name which existing authoritative source supplies each policy input. Where an authority does not yet exist, the feature remains blocked rather than introducing a substitute authority.

## Gate state

```
DTO: ADMITTED
W05 physical binding: VERIFIED
D1-02 migration/schema: VERIFIED
Trusted admission-input contract: CREATED / BLOCKED_NOT_ADMITTED
Runtime transport/admission: BLOCKED
W05 runtime: NOT ADMITTED
Runtime evidence: REQUIRED
SOCIAL-001: NOT_GREEN
```
