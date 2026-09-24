# AUTH-013 Event Contract / Durable Publication / Actor Decision Input — 2026-09-24

- Decision ID: `CC-MAPPING-0-AUTH-013-EVENT-CONTRACT-AND-ACTOR-DECISION-INPUT-2026-09-24`
- Feature: `AUTH-013`
- Scope: W02 authoritative account-state transition → durable event intent → queue/consumer → W06 AuditEvent persistence
- Repository authority: GitHub `main`
- Status: **DECISION_INPUT / WAIT_AUTHORITY_DECISION**

## 1. Current verified baseline

Already-verified sub-gates remain inherited and are not re-run:

- W02 AUTH-013 transition kernel: Run `35943346415` = PASS_VERIFIED.
- AUTH-013 D1-01 migration: Run `35937873769` = PASS_VERIFIED.
- W06 AuditEvent source/runtime boundary: Run `35982576756` = PASS_VERIFIED.
- W06 D1-03 AuditEvent schema/migration: Run `35975461648` = PASS_VERIFIED.
- W06 controlled version upload/binding: Run `35983760891` = PASS for upload/binding only; Cloudflare reported `No targets deployed`.

No new runtime implementation is introduced by this document.

## 2. Current authority that already exists

The repository already has the platform-level event semantics contract:

`docs/163-EVENT-SEMANTICS-DELIVERY-ORDERING-REPLAY-DLQ-CONTRACT-v1.0.md`

It defines:

- canonical event envelope;
- schema versioning;
- at-least-once delivery;
- consumer idempotency;
- ordering by resource/aggregate/stream where declared;
- retry / DLQ / replay semantics;
- durable publication boundary between authoritative mutation and event intent;
- producer owns event meaning; consumer owns derived reaction.

The canonical D1 Domain Master also defines:

`Authoritative transaction → Outbox/event → Queue/consumer → Idempotent state transition → Reconciliation/evidence`

and places Outbox / Inbox / operational idempotency records in D1-03.

These are authoritative platform rules.

## 3. What is NOT currently admitted

Current repository inspection does not establish any of the following as an executable AUTH-013 implementation:

1. a dedicated `identity.account_state_changed` event schema/version record;
2. a concrete producer/outbox implementation attached to `applyAccountStateTransition()`;
3. an admitted queue resource/binding for this event;
4. an executable W10 implementation;
5. an explicit AUTH-013 queue-consumer ownership decision;
6. a canonical representation of the state-machine `operator` actor in the common Actor schema.

The current W02 worker binds only D1-01. The current AUTH-013 transition function performs the authoritative D1-01 state/version mutation and returns the transition result, but does not publish an event or call W06.

No Cloudflare Queue binding was found in the current repository search.

## 4. Decision Q1 — Durable publication boundary / Outbox placement

### Problem

The canonical architecture requires durable event intent after the authoritative W02 transaction, but the current canonical D1 model places Outbox under D1-03 while the account transaction is authoritative in D1-01.

A direct W02 write to D1-03 is forbidden, and a direct W02 → W06 Service Binding is also forbidden.

Therefore the exact durable boundary is not implementation-admitted.

### Decision required

Select one already-compatible interpretation and document its authority before implementation:

**Option A — D1-01-local durable event intent**

The W02 authoritative transaction records the event intent atomically within D1-01, and a controlled relay publishes it to the approved queue/consumer path. The record must be explicitly classified as a publication journal implementation detail rather than a second business authority, and its relationship to the canonical D1-03 Outbox concept must be approved.

**Option B — Existing D1-03 Outbox as the durable boundary**

A mechanism must be explicitly admitted that guarantees the W02 committed transition cannot permanently lose its corresponding D1-03 Outbox intent despite the lack of a distributed D1 transaction. The mechanism cannot rely on an unbounded best-effort post-commit Worker call.

**Option C — Another already-authoritative durable publication mechanism**

Only an existing platform mechanism may be used. It must preserve the same atomicity/durability requirement and may not introduce another Worker or D1.

No option is selected by inference in this document.

## 5. Decision Q2 — AUTH-013 consumer ownership

The canonical Worker Master states:

- W06 owns Rights / Trust & Safety / Governance and D1-03 AuditEvent authority.
- W10 is Async / Queue / Job Execution.
- W10 intentionally has no artificial Primary Task.

The repository currently has no executable `workers/W10*` implementation or queue binding that can be inherited as current runtime evidence.

### Decision required

Explicitly authorize one existing Worker boundary for the AUTH-013 consumer:

**Option A — W10 execution boundary**

W10 owns queue execution mechanics under an explicitly admitted AUTH-013 task/event contract and invokes the W06-authorized AuditEvent persistence boundary.

**Option B — W06 consumer boundary**

W06 directly consumes the approved event while retaining sole D1-03 AuditEvent write authority. Any queue/runtime binding must be admitted as W06 operational capability without turning W06 into a generic async execution Worker.

**Constraint**

No new Worker, no new D1, no unrestricted cross-D1 writer.

## 6. Decision Q3 — Actor normalization

Current authoritative inputs conflict:

- `contracts/state-machines/account.json` permits `operator` on several account-state transitions.
- `contracts/schemas/common/actor.json` permits only:
  `user | service | admin | system | job`.
- W02 runtime currently enforces the state-machine actor values.
- W06 AuditEvent construction follows the common Actor enum.

### Decision required

Select one canonical representation:

**Option A — Extend common Actor**

Admit `operator` as a first-class canonical Actor type and update all dependent schemas/tests/contracts through Change Control.

**Option B — Normalize operator to an existing Actor type**

Define the exact authoritative mapping and semantic justification. No runtime mapping may be implemented without that decision.

**Option C — Separate principal type from operational role**

Keep canonical Actor type as the security principal class while representing `operator` as a separate, explicitly contracted role/claim. This requires a bounded schema change before runtime implementation.

No silent `operator → admin/service` conversion is permitted.

## 7. Minimum admitted event contract after decision

Once Q1–Q3 are approved, the smallest AUTH-013 event contract should bind, at minimum:

- eventType = `identity.account_state_changed`;
- explicit schemaVersion;
- eventId;
- producer = W02 / D1-01;
- resourceType = `User`;
- resourceId = canonical User ID;
- sourceVersion = resulting `account_state_version`;
- occurredAt / publishedAt;
- correlationId / causationId;
- idempotencyKey;
- actor representation;
- before state + before version;
- after state + after version;
- transition reason where permitted by the lifecycle contract;
- consumer/idempotency semantics;
- queue/consumer owner;
- retry / DLQ / replay behavior.

This is a **decision target**, not yet an admitted Contract schema.

## 8. Explicit non-actions

Until Q1–Q3 are decided:

- do not change `contracts/schemas/common/actor.json`;
- do not change `contracts/state-machines/account.json`;
- do not create `identity.account_state_changed.v1.json` as authoritative;
- do not create a new Worker or D1;
- do not add W02 → W06 Service Binding;
- do not add a public route for evidence generation;
- do not implement an ad-hoc D1-03 Outbox writer in W02;
- do not assign AUTH-013 to W10 by inference.

## 9. Current disposition

**AUTH-013 downstream event/audit integration = BLOCKED_NOT_GREEN / WAIT_AUTHORITY_DECISION**

Already-verified runtime foundations remain valid and are inherited.

### Next admitted step

After Q1–Q3 authority resolution:

```text
Decision
→ Contract delta
→ Reconciliation
→ smallest producer/consumer implementation
→ source CI
→ controlled runtime evidence
→ real W02 transition
→ durable event delivery
→ W06 AuditEvent persistence
→ cache/session/deindex side-effect evidence
→ E2E security/integration
→ Evidence Registry promotion
```

This document does not authorize implementation by itself.
