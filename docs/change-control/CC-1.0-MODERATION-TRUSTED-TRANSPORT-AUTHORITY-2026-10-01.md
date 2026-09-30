# CC-1.0 Moderation Trusted Transport Authority — 2026-10-01

**Status: AUTHORITY-REQUIRED / IMPLEMENTATION-BLOCKED**

Repository: `wanghuinet/luckread`  
Base head: `6c619f1e56b35e20477315bae4904914e16844a0`

## 1. Purpose

Close the remaining authority decision before the moderation runtime may be implemented.

Current moderation contracts already cover:

- GOV-003 moderation queue and GOV-004 enforcement case identity;
- canonical OpenAPI operations `listModerationQueue`, `getModerationCase`, `decideModerationCase`;
- DTO bindings;
- W06/D1-03 ModerationCase and ModerationDecision entity vocabulary;
- D1-03 logical persistence contract;
- moderation decision → canonical `AuditEvent` binding;
- L6 moderation permissions and conditional-request/idempotency rules.

The remaining blocker is the trusted internal transport needed to carry the authenticated reviewer context into W06 and to carry the accepted content-state command from W06 to W03.

## 2. Existing topology that can be reused

1. W01 is the public API / Gateway boundary and already resolves the authenticated principal through the existing W01→W02 authorization path.
2. W01 already has the admitted W03_CONTENT binding and W03 remains the sole content-state authority.
3. W06 already owns D1-03 governance/moderation operational state.
4. No additional Worker, D1 database, Payload collection, or public API namespace is required.

## 3. Candidate minimum transport topology

### A. Reviewer request

**W01 → W06**

Candidate internal Service Binding:

- caller: W01
- callee: W06
- proposed binding name: `W06_MODERATION`
- public exposure: false
- purpose: forward only the server-derived reviewer context and the already-contracted moderation request.
- W01 remains the authentication edge; W06 remains moderation authority.
- no end-user bearer token is forwarded as an authority credential.

Required trusted headers/context remain those already contracted in `MODERATION-001-trusted-reviewer-admission-input.v1.json`:

- actorUserId
- reviewerId (server-derived)
- reviewerLayer (server-derived)
- permissionContext (server-derived)
- correlationId / requestId
- If-Match and expectedVersion when deciding.

### B. Moderation decision to content authority

**W06 → W03**

Candidate internal Service Binding:

- caller: W06
- callee: W03
- proposed binding name: `W03_CONTENT_MODERATION`
- public exposure: false
- purpose: submit only the explicitly admitted `PENDING_REVIEW → APPROVED/REJECTED` transition command.
- W06 supplies the moderation decision provenance; W03 remains authoritative for the actual content lifecycle mutation.
- no W06 direct D1-02 read/write is allowed.

## 4. Why this is the minimum direct-call shape

The two boundaries separate two different authorities:

`W01 → W06` carries reviewer authority into the governance domain.

`W06 → W03` carries the accepted governance command into the content domain.

Collapsing these boundaries would either put moderation authority into W01 or content-state authority into W06, both of which contradict the existing contracts.

No third synchronous business Worker call is proposed. Projection, feed, search and notification side effects remain asynchronous.

## 5. Required authority decision

The following configuration changes require explicit authority admission before implementation:

- authorize the W01 → W06 internal Service Binding;
- authorize the W06 → W03 internal Service Binding;
- authorize their exact internal paths, headers, timeout/retry/fail-closed behavior and source-commit evidence;
- authorize the associated negative security tests.

This document is **decision material only**. It does not modify Worker configuration, deploy anything to Cloudflare, create resources, or authorize W06 runtime.

## 6. Evidence that must follow authorization

Before moderation runtime can become implementation-admitted:

- exact binding/source SHA evidence;
- authenticated principal propagation evidence;
- reviewer layer/permission scope derivation evidence;
- unauthorized/insufficient-layer/outsider-scope negative evidence;
- W06→W03 content transition evidence;
- If-Match 428/412 evidence;
- Idempotency-Key replay and key-reuse-conflict evidence;
- decision→AuditEvent one-to-one evidence;
- D1-03 migration and remote schema evidence;
- runtime integration and security E2E evidence.

## 7. Hard constraints

- 12 Workers / 4 D1 remains unchanged.
- No new Worker.
- No new D1.
- No Payload moderation authority.
- No direct W06→W03 table access.
- No direct W05/W02 moderation authority.
- No public exposure of the internal bindings.
- No runtime GREEN claim from this decision packet.

## 8. Current decision

**AUTHORITY-REQUIRED.**

Until the two internal transport boundaries above are explicitly admitted, the moderation runtime stays **BLOCKED**.
