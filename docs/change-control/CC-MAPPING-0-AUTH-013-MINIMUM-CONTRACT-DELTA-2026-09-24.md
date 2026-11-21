# AUTH-013 — Minimum Contract Delta — 2026-09-24

- Authority Decision: `CC-MAPPING-0-AUTH-013-EVENT-ACTOR-TRANSPORT-AUTHORITY-2026-09-24`
- Status: **APPROVED DELTA / RECONCILIATION REQUIRED**
- Scope: only the minimum Contract changes needed to implement AUTH-013 downstream event/audit integration.

## 1. Changes admitted

### 1.1 Common Actor

Add optional `operationalRole`.

Semantics:
- contextual role metadata;
- never sufficient for ALLOW;
- Authorization Decision remains authoritative;
- existing account-state `operator` representation is emitted as `actorType=user` + `operationalRole=PLATFORM_OPERATOR`.

### 1.2 Event

Create `contracts/events/identity-account-state-changed.v1.json`.

Canonical event:
`identity.account_state_changed`

Producer: W02 / D1-01.
Consumer: W06 / D1-03.
Delivery: at-least-once, per-resource ordering, idempotent consumer, bounded retry, DLQ.

### 1.3 Producer-local durable publication journal

The minimum D1-01 durable journal is not a second business authority.

Required logical record:

| Field | Requirement |
|---|---|
| journalId | canonical Resource ID |
| eventId | unique event Resource ID |
| eventType | `identity.account_state_changed` |
| schemaVersion | `1.0` |
| resourceId | canonical User ID |
| sourceVersion | resulting `account_state_version` |
| payload | immutable event payload |
| status | `PENDING` / `PUBLISHED` / `FAILED` |
| attempt | positive integer |
| nextAttemptAt | nullable date-time |
| createdAt | date-time |
| publishedAt | nullable date-time |
| lastErrorCode | nullable bounded string |

Atomicity invariant:

```
users.account_state/version update
+
journal INSERT
```

must commit atomically in D1-01.

The journal can never become Account State authority.

### 1.4 Queue boundary

Canonical queue names:

- `luckread-auth013-account-state`
- `luckread-auth013-account-state-dlq`

Exactly one active consumer: W06.

## 2. Explicit non-changes

- no D1 count change;
- no Worker count change;
- W10 remains generic async boundary with no AUTH-013 ownership;
- no W02 → W06 synchronous business Service Binding;
- no W02 D1-03 write;
- no change to the authoritative Account State transition matrix;
- no new public API operation.

## 3. Required implementation sequence

```
Contract CI
→ journal migration
→ W02 atomic transition+journal
→ controlled publisher
→ Queue resource/binding
→ W06 consumer + idempotency
→ Source CI
→ controlled deployment
→ real transition
→ AuditEvent evidence
→ side-effect evidence
```

## 4. Reconciliation acceptance

The following must be GREEN before runtime implementation is promoted:
- schema validation;
- actor/state-machine reconciliation;
- producer/consumer topology;
- Queue/DLQ consistency;
- D1-01 journal atomicity;
- W06 AuditEvent authority preservation.
