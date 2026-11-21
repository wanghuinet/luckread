# AUTH-013 — Event / Publication / Consumer / Actor Authority Decision — 2026-09-24

- Decision ID: `CC-MAPPING-0-AUTH-013-EVENT-ACTOR-TRANSPORT-AUTHORITY-2026-09-24`
- Feature: `AUTH-013`
- Status: **APPROVED**
- Repository authority: GitHub `main`
- Decision basis:
  - canonical Ultimate / Project Blueprint
  - active 12-Worker / 4-D1 Worker Master and D1 Domain Master
  - Event Semantics / Saga / Identity lifecycle contracts
  - verified W02/W06 runtime foundations
  - Cloudflare Queue current delivery model
- Scope: durable publication boundary, consumer ownership, actor representation for `identity.account_state_changed`

## 1. Executive decision

The remaining AUTH-013 authority gate is resolved as follows:

```
Q1 = A
Q2 = B
Q3 = C
```

Therefore:

```
W02 / D1-01
  authoritative Account State transaction
        +
  D1-01-local durable publication journal
        ↓
  controlled Queue publisher
        ↓
  AUTH-013 Queue
        ↓
  W06 scoped consumer
        ↓
  W06 / D1-03 AuditEvent + idempotency
```

No new Worker or D1 is introduced.

## 2. Q1 — Durable publication boundary

### Decision

**APPROVED: Option A — D1-01-local durable publication journal.**

The authoritative W02 transaction MUST persist the minimum durable event intent in D1-01 in the same atomic database transaction that advances `account_state_version`.

The record is a **publication journal**, not a second business authority and not a second Account State store.

### Reconciliation with the D1-03 Outbox rule

The canonical D1 Master assigns the operational Outbox concept to D1-03. That rule remains intact.

For AUTH-013 specifically:

- D1-01 owns the atomic publication-journal record because only D1-01 can commit it atomically with Account State.
- The publication journal is semantically equivalent to the producer-side durable publication boundary required by the Event Semantics contract.
- W06/D1-03 remains authoritative for AuditEvent, Inbox/idempotency and downstream operational governance state.
- The journal MUST contain enough immutable event metadata for a controlled publisher/retry/reconciliation process.
- No W02 write to D1-03 is permitted.
- No post-commit best-effort Worker-to-Worker call may be used as the durability mechanism.

This is an approved bounded refinement of the cross-D1 Outbox pattern; it does not create a fifth D1 or a second business authority.

## 3. Q2 — Consumer ownership

### Decision

**APPROVED: Option B — W06 is the scoped AUTH-013 Queue consumer.**

W06 is permitted to consume only the AUTH-013 governance/audit event stream admitted by this decision.

W06 retains sole D1-03 AuditEvent write authority.

This does not promote W06 into the generic asynchronous Worker. W10 remains the canonical generic Async / Queue / Job Execution boundary and retains no artificial Primary Task.

No AUTH-013 consumer is assigned to W10.

## 4. Q3 — Actor representation

### Decision

**APPROVED: Option C — security principal class and operational role remain separate.**

For a human `PLATFORM_OPERATOR` actor:

- Common Actor `actorType` = `user`
- Common Actor `operationalRole` = `PLATFORM_OPERATOR`

The account state machine's existing `operator` transition actor remains semantically mapped to the already-canonical `PLATFORM_OPERATOR` principal/role concept.

No silent `operator → admin` or `operator → service` coercion is permitted.

The operational role does not itself grant authorization; the existing Authorization Decision contract remains authoritative.

The minimum schema refinement is therefore an optional, bounded `operationalRole` field on Common Actor, with AUTH-013 requiring the value `PLATFORM_OPERATOR` when the state-machine actor is `operator`.

## 5. Queue contract

The AUTH-013 transport is admitted as one isolated critical-domain event stream.

Contractual properties:

- one active consumer: W06;
- at-least-once delivery;
- consumer idempotency required;
- bounded retries;
- DLQ required;
- per-user/resource ordering;
- eventId + idempotencyKey based deduplication;
- replay must not create duplicate AuditEvent records;
- failed messages must be observable and repairable.

Cloudflare Queues supports Worker producer/consumer bindings, at-least-once delivery, retries and DLQ configuration. The Queue is a transport boundary, not a substitute for the D1-01 durable publication transaction. citeturn890805search1turn890805search2turn890805search8

## 6. Event authority

The canonical event name is:

`identity.account_state_changed`

Producer authority:

`W02 / D1-01`

Consumer authority:

`W06 / D1-03`

Event meaning remains owned by W02. W06 only performs its contracted derived audit/governance reaction.

## 7. Minimum event payload

The event MUST carry:

- `eventId`
- `eventType = identity.account_state_changed`
- `schemaVersion`
- `producer = W02`
- `resourceType = User`
- `resourceId`
- `occurredAt`
- `publishedAt`
- `correlationId`
- `causationId`
- `idempotencyKey`
- `attempt`
- `sourceVersion`
- actor with principal class + operational role
- `before`
- `after`
- transition `reason`

No credential, token, password, secret or unnecessary private data may be placed in the event.

## 8. Explicitly forbidden

- no fifth D1;
- no thirteenth Worker;
- no W02 → W06 direct business Service Binding;
- no W02 direct D1-03 write;
- no W10 AUTH-013 ownership by inference;
- no public route created only to manufacture evidence;
- no actor normalization to `admin` or `service`;
- no event-as-authority design;
- no best-effort post-commit publication;
- no implementation before the minimum Contract Delta is reconciled and CI-enabled.

## 9. Implementation authorization boundary

This decision **authorizes the Contract Delta and its reconciliation**.

It does not mark AUTH-013 GREEN.

The implementation sequence is now:

```
Approved Authority Decision
→ minimum Contract Delta
→ Reconciliation / Contract CI
→ W02 journal + publisher
→ Queue resource / binding
→ W06 consumer + idempotency
→ source CI
→ controlled deployment
→ real transition
→ durable publication evidence
→ W06 AuditEvent evidence
→ token/session/cache/deindex side-effect evidence
→ E2E
→ Evidence Registry promotion
```

## 10. Acceptance

AUTH-013 downstream event/audit integration is no longer blocked on Q1/Q2/Q3 authority.

New status:

**AUTH-013 AUTHORITY GATE = GREEN**

**AUTH-013 IMPLEMENTATION GATE = OPEN only for the minimum approved Contract Delta and directly dependent implementation slices.**

