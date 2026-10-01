# CC-1.8 — Moderation Idempotency Replay Ordering Correction — 2026-10-01

## Purpose
Record the implementation gap exposed by Security E2E run `36806374286`: a completed moderation decision increments the authoritative case version, but the current W06 runtime validates `If-Match` before checking an existing completed Idempotency-Key record. This prevents a valid same-key/same-payload replay from reaching the canonical idempotency branch.

## Contract basis
The canonical concurrency/idempotency contract requires:
- same Key + same Payload + COMPLETED → return the original result without repeating side effects;
- same Key + different Payload → `422 IDEMPOTENCY_KEY_REUSE_CONFLICT`;
- `If-Match` is required for the initial protected write.

The W01/W06 moderation transport contract separately requires both `If-Match` and `Idempotency-Key` and requires executable evidence for idempotent replay and key-reuse conflict.

## Observed evidence
Run `36806374286`:
- native L6 reviewer establishment: PASS;
- queue/case visibility: PASS;
- initial APPROVED decision: PASS;
- W06 decision persistence: PASS;
- replay assertion: failed because the replay request using the original `If-Match: v1` was rejected before the stored idempotency result could be returned.

Source review of `workers/W06-governance/src/moderation-runtime.ts` confirms the current order is:
1. load case + optional idempotency row;
2. validate current `version` / `If-Match`;
3. calculate request hash;
4. inspect existing idempotency record.

## Admitted correction
Reorder only the idempotency evaluation inside `decideModerationCase`:
1. compute the canonical request hash from the submitted decision payload;
2. when an unexpired idempotency record exists for the same reviewer/case/key:
   - matching hash → return the stored committed response;
   - different hash → return `422 IDEMPOTENCY_KEY_REUSE_CONFLICT`;
3. only when no usable idempotency record exists, enforce current `If-Match` / expectedVersion and proceed with the authoritative D1-03 transaction.

This preserves the initial-write optimistic concurrency gate while making completed same-key replay conform to the canonical idempotency contract.

## Non-changes
- no new Worker;
- no new D1;
- no schema migration;
- no binding/topology expansion;
- no API path change;
- no Contract semantic change;
- no change to W06→W03 outbox authority boundary.

## Backup
`backup/pre-moderation-idempotency-runtime-order-20261001` created from main before implementation.

## Acceptance
A clean Security E2E run must prove:
- initial decision succeeds;
- same-key/same-payload replay returns the original response;
- same-key/different-payload returns 422;
- missing If-Match returns 428 on a fresh case;
- stale If-Match returns 412 on a fresh case;
- Decision + AuditEvent + Outbox persist together;
- W03 eventually converges to APPROVED;
- evidence artifact is tied to the exact tested source SHA.

Status: NOT_GREEN until the corrected runtime is deployed and the complete Security E2E evidence is reconciled.
