# CC-1.3 Moderation Transactional-Outbox Delivery Decision — 2026-10-01

**Status: DECISION ADMITTED**

## Decision

For `decideModerationCase`, W06/D1-03 is the only authoritative decision transaction. The W06→W03 content-state command is an asynchronous enforcement side effect backed by a D1-03 transactional outbox.

The request path may perform an immediate best-effort delivery after the D1-03 transaction commits, but:

- the W03 response MUST NOT determine whether the moderation decision is accepted;
- a W03 failure MUST NOT roll back or invalidate the committed moderation decision;
- every accepted decision has exactly one durable outbox record;
- retries use the same decisionId + Idempotency-Key and are therefore safe;
- scheduled W06 delivery drains pending/retry outbox records and is the recovery path.

## Why

The previously implemented order of `W03 transition → W06 decision transaction` allowed a partial cross-D1 success. A distributed transaction is prohibited by the platform baseline.

The chosen correction is:

```
W01
  → W06
    → D1-03 transaction:
       ModerationDecision
       ModerationCase
       IdempotencyRecord
       AuditEvent
       EnforcementOutbox
    → best-effort W06→W03 delivery
       → W03/D1-02 authoritative content state
    → retry via W06 scheduled drain
```

## Contract alignment

This decision changes the enforcement event budget from `syncConsumersMax: 0` to `syncConsumersMax: 1`, with the explicit rule that the synchronous delivery is non-authoritative and non-blocking with respect to decision acceptance.

No new Worker or D1 is introduced. No direct cross-D1 table access is introduced.

## GREEN evidence required

- one D1-03 transaction containing Decision + AuditEvent + Outbox;
- W03 positive APPROVED/REJECTED transition;
- W03 stale/missing-provenance rejection;
- idempotent W03 replay;
- scheduled outbox retry after injected W03 failure;
- Decision remains committed when W03 is unavailable;
- eventual W03 convergence from the durable outbox;
- no Authorization header forwarded W06→W03;
- no direct W06→D1-02 access.
