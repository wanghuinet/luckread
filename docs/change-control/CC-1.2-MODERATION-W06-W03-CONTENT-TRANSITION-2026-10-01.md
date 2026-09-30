# CC-1.2 Moderation W06→W03 Content Transition Transport — 2026-10-01

**Status: AUTHORITY-REQUIRED / RUNTIME-IMPLEMENTATION-BLOCKED**

Repository: `wanghuinet/luckread`

## 1. Scope

This gate covers only the internal path that carries an accepted GOV-004 moderation decision from W06 to the existing W03 content lifecycle authority.

It does not create a Worker, D1, Payload collection, public endpoint or new public operationId.

## 2. Contract boundary

Machine-readable contract:

`contracts/transport/W06-W03-content-moderation-http-binding.v1.json`

Candidate binding:

`W06 → W03` via `W03_CONTENT_MODERATION`

Target operation remains the existing `transitionContentState`; only the trusted caller boundary changes.

## 3. Authority separation

- W06 owns the ModerationDecision and governance decision provenance.
- W03 owns Content state and performs the single D1-02 authoritative state mutation.
- The only allowed moderation transitions are `PENDING_REVIEW → APPROVED` and `PENDING_REVIEW → REJECTED`.
- W06 never writes W03 tables directly.
- No end-user bearer token crosses the internal binding.

## 4. Required inputs

The transport preserves server-derived principal and decision provenance:

- principal user id and L0-L8 layer;
- moderation decision id;
- policy version;
- outcome;
- correlation id;
- If-Match for the target content version;
- Idempotency-Key.

W03 must fail closed on missing provenance, stale content version, invalid state or unsupported transition.

## 5. Authority decision required

Before configuration/runtime changes, explicitly admit the `W06 → W03` Service Binding and its exact internal contract.

This document is decision material only. No binding is deployed and no runtime implementation is authorized by this file.

## 6. Evidence required after authorization

- exact W06/W03 source commits;
- binding deployment evidence;
- positive APPROVED and REJECTED transitions from PENDING_REVIEW;
- stale If-Match 412 evidence;
- missing precondition 428 evidence;
- idempotency replay evidence;
- unauthorized/invalid provenance negative evidence;
- proof that W06 has no direct D1-02 access;
- one-to-one decision attribution evidence.

## 7. Fixed architecture

12 Workers / 4 D1 remains unchanged.

**Current decision: AUTHORITY-REQUIRED.**
