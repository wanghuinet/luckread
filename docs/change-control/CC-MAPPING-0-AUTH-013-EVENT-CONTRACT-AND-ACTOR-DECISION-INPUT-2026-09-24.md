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


## 10. Superpowers recommended resolution profile — NOT YET AUTHORIZED

The following is a technical recommendation for authority review, derived from the frozen Worker/D1 contracts, the platform Event Semantics contract, the Cross-Domain Saga contract, and the absence of an existing executable W10/Queue implementation.

### Q1 recommended profile — producer-local durable intent + operational delivery records

**Recommendation:** preserve W02 as the sole D1-01 account authority, but admit a minimal producer-local durable event-intent record in the same D1-01 transaction as the account-state version update. Treat that record as a publication journal for delivery correctness, not as a second business authority.

Then:

```text
W02 / D1-01 authoritative transaction
    ├─ users.account_state/version
    └─ durable event intent
            ↓
controlled publisher
            ↓
Cloudflare Queue
            ↓
W06 consumer
            ↓
W06 / D1-03 AuditEvent + operational idempotency
```

Rationale:

- A producer-local durable intent is the standard way to prevent the post-commit event-loss window for an authoritative transaction.
- Cloudflare Queues provide explicit producer/consumer bindings and at-least-once delivery; they do not themselves make a D1 transaction atomic with publication. citeturn969585search0turn969585search5
- Keeping the account-state mutation and its durable event intent in W02/D1-01 preserves the authoritative transaction boundary.
- W06 remains the sole writer of AuditEvent in D1-03.
- This does require an explicit Change-Control refinement because the current D1 Master describes Outbox as a D1-03 operational record.

**Important:** this is a recommended interpretation of the frozen rules, not an implementation authorization.

### Q2 recommended profile — W06 as the scoped consumer

**Recommendation:** use the existing W06 Worker as the dedicated consumer for the AUTH-013 AuditEvent queue, rather than assigning the work to W10.

Rationale:

- W06 already owns D1-03 AuditEvent authority.
- W10 has no Primary Task and no current executable Worker implementation in the repository.
- The queue is a transport mechanism; a scoped W06 consumer does not make W06 a generic async Worker if its consumer scope is explicitly limited to governance/audit events.
- Cloudflare supports an existing Worker as a queue consumer via Wrangler consumer binding. citeturn969585search0turn969585search1

This still requires explicit authority admission because current Worker Master language identifies W10 as the generic Async/Queue/Job boundary.

### Q3 recommended profile — separate principal type from operational role

**Recommendation:** do not extend the canonical principal-class enum with `operator` and do not map `operator` to `admin` or `service` silently.

Instead, refine the event/audit actor representation so that:

- `actorType` describes the security principal class;
- an explicit role/operational-role field carries `operator`;
- the account state transition contract records the exact required role separately from principal type;
- audit retains the actual actor identity plus the operational role that authorized the action.

This preserves the identity/role separation principle already established in the account lifecycle contract and avoids widening privileges merely for audit serialization.

This requires a bounded Contract Change-Control update to the actor/state-machine representation before implementation.

### Recommended final shape

```text
W02
  authoritative account transition
        +
  producer-local durable event intent
        ↓
Cloudflare Queue
        ↓
W06 scoped consumer
        ↓
idempotent AuditEvent persistence
        ↓
side-effect consumers / reconciliation
```

No W13, no D1-05, no W02→W06 direct binding, no public-route workaround, and no silent actor coercion.

### Authority gate

The recommended profile should remain **PROPOSED / NOT_AUTHORIZED** until the formal Change-Control decision explicitly accepts:

1. producer-local durable intent as compatible with the D1-03 Outbox rule;
2. W06 as the scoped AUTH-013 queue consumer;
3. the actor principal-type / operational-role separation.

Only after those three are accepted may the minimum Contract delta be written and implementation begin.


## 11. Q3 narrowing after Principal/Role reconciliation

Current authority inspection found an existing P0 Principal/Scope contract:

`docs/168-GLOBAL-SCOPE-TENANT-ORGANIZATION-ISOLATION-CONTRACT-v1.0.md`

It explicitly defines `PLATFORM_OPERATOR` as a supported Principal Type and requires:

`Authentication → Principal → Active Scope → Domain Authorization → Action → Audit`

It also explicitly distinguishes identity from scope and requires explicit approval, limited scope and full audit for Platform Operator special access.

Separately, `docs/303` establishes that Identity and Role are distinct concepts and requires account-state transitions to record actor identity/type.

### Result

The unresolved Q3 issue is **not** whether an `operator` business role exists.

That role/principal concept already exists as `PLATFORM_OPERATOR`.

The remaining contract question is narrower:

- Which canonical **security principal class** is emitted in Common Actor for a PLATFORM_OPERATOR-initiated transition?
- Where is the `PLATFORM_OPERATOR` operational role retained so audit preserves the authorization context?
- How is that representation kept consistent with the existing Common Actor schema without broadening authority?

No existing contract was found that authoritatively maps `PLATFORM_OPERATOR` to Common Actor `admin`, `service`, `user`, `system`, or `job`.

Therefore Q3 remains **UNRESOLVED**, but the required Change-Control scope is now limited to **principal-class + operational-role representation**, not creation of a new operator role.


## 12. Authority-ready atomic decision matrix

This section is intentionally a decision aid, not an implementation authorization.

| ID | Decision | Proposed default | Alternatives | Effect if approved |
|---|---|---|---|---|
| Q1 | Durable publication boundary | **A — W02/D1-01-local durable event intent**, classified as publication journal and reconciled to D1-03 operational Outbox semantics | B — explicitly approved D1-03 durable boundary via another already-authoritative mechanism; C — another existing durable platform mechanism | Authorizes exact producer durability model before any code |
| Q2 | Consumer ownership | **B — W06 scoped AUTH-013 consumer** | A — W10 execution boundary after explicit task/event admission | Authorizes which existing Worker owns Queue consumption |
| Q3 | Principal/role representation | **C — keep Common Actor principal class separate and carry `PLATFORM_OPERATOR` as explicit operational role** | A — add `operator` to Common Actor; B — explicit authoritative mapping to an existing Actor class | Resolves AuditEvent actor representation without silent privilege coercion |

### Exact approval consequences

**Q1-A** permits a bounded D1-01 publication-journal record to be written in the same authoritative account-state transaction. It does not permit a second account authority and does not make the journal an alternative business source of truth.

**Q2-B** permits the existing W06 Worker to receive a narrowly scoped AUTH-013 queue consumer binding while retaining sole D1-03 AuditEvent write authority. It does not grant W06 generic async ownership.

**Q3-C** requires the minimum Actor/Event Contract delta to represent both the security principal class and the `PLATFORM_OPERATOR` operational role. The principal class must still use an already-canonical class; no privilege expansion is implied.

### Approval protocol

An Authority Decision must explicitly state all three values, for example:

Q1=A; Q2=B; Q3=C

or identify a different permitted option for each question.

Until all three are explicitly decided, AUTH-013 remains **BLOCKED_NOT_GREEN / IMPLEMENTATION_NOT_AUTHORIZED**.
