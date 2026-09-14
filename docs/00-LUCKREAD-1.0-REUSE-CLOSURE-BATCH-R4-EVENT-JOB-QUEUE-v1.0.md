# Luckread 1.0 Reuse Closure — Batch R4 Event / Job / Queue v1.0

> Status: **CLOSED / REUSE ALLOCATED / ASYNC FOUNDATION LOCKED**
>
> Scope: consolidate reusable 1.0 event, asynchronous job, queue, retry, replay and dead-letter assets into the canonical 2.0 Event / Job / Reliability model. This batch does not create a second event bus, queue authority, or business-domain state authority.

## 1. Objective

Close the fourth 1.0 reuse batch using the fixed rule:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence`

The purpose is to preserve mature reliability behavior while preventing domain-specific implementations from becoming duplicate platform authorities.

## 2. Existing assets verified

The repository already contains strong reusable material:

- `docs/d21-event-registry-v1.0.yaml` — frozen advertising event registry with at-least-once delivery, idempotent consumers, replay, schema versioning, DLQ and evidence requirements.
- `docs/71-PLATFORM-OPERATIONS-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md` — platform-wide admission rules for timeout, retry, idempotency, queue recovery, replay and backfill.
- `docs/187-L5-L6-MEDIA-MEDIA-PROCESSING-INSTANCE-REGISTRY-v1.0.md` — concrete media enqueue/claim/heartbeat/retry/DLQ/replay/cancel/rebuild/reconciliation capabilities.
- `contracts/state-machines/job.json` — canonical Job lifecycle with optimistic locking and terminal states.
- Blueprint `JOB-001..JOB-008` — canonical async/queue/scheduling feature inventory.

These are reuse inputs, not parallel authorities.

## 3. Reuse disposition

| 1.0 asset / capability | 2.0 canonical owner | Disposition | Rule |
|---|---|---|---|
| Event envelope | EVENT / API | DIRECT-REUSE | Preserve trace, tenant, subject, producer and idempotency fields |
| Event schema versioning | EVENT / API | DIRECT-REUSE | Unknown versions reject or quarantine |
| At-least-once delivery | EVENT / RELIABILITY | DIRECT-REUSE | Consumers must be idempotent |
| Event deduplication | EVENT / RELIABILITY | DIRECT-REUSE | `event_id` / producer idempotency key is required |
| Per-aggregate ordering | EVENT / RELIABILITY | DIRECT-REUSE | Ordering only where domain contract requires it |
| Event replay | EVENT / JOB | DIRECT-REUSE | Replay preserves original event identity and adds replay metadata |
| Unknown-event quarantine | EVENT / SAFETY | DIRECT-REUSE | Unknown events never silently execute |
| Dead-letter queue | JOB / RELIABILITY | DIRECT-REUSE | Poison/exhausted messages retained and recoverable |
| Retry/backoff | JOB / RELIABILITY | DIRECT-REUSE | Bounded and deterministic; no infinite retry |
| Job state machine | JOB | ALREADY-ABSORBED | Reuse canonical `contracts/state-machines/job.json` |
| Job claim/lease | JOB / RELIABILITY | MERGE | Prevent duplicate active execution |
| Job heartbeat | JOB / OBS | MERGE | Deterministic liveness/timeout handling |
| Job cancellation | JOB | MERGE | Late completion cannot regress authoritative state |
| Media processing orchestration | MEDIA / JOB | DIRECT-REUSE | Domain-specific orchestration remains under Media authority |
| Backfill | JOB / OPS | MERGE | Elevated permission + reconciliation evidence |
| Rebuild projections | JOB / domain | MERGE | Rebuild derived state only; never rewrite domain truth |
| Saga/compensation | JOB / domain contracts | MERGE | Only where cross-domain consistency requires it |
| Queue controls | JOB / OPS | MERGE | Queue is transport/execution infrastructure, not business truth |
| Notification delivery queue | NOTIFY / JOB | REFACTOR | Hot delivery path stays outside Payload business collections |
| Analytics event consumers | ANALYTICS / EVENT | REFACTOR | Derived metrics only; cannot rewrite authoritative facts |
| Advertising event registry | ADVERTISING / EVENT | DIRECT-REUSE | Remains domain-scoped D21 registry |

## 4. Canonical event contract

Every platform event must provide, as applicable:

```text
event_id
event_type
event_version
schema_version
occurred_at
producer
request_id
trace_id
correlation_id
causation_id
tenant_id
organization_id
actor_id
subject_id
idempotency_key
privacy_classification
payload
```

The D21 registry already demonstrates this envelope and additionally requires tenant isolation, immutable raw events, append-only billing events and replay safety. Those rules are retained where applicable. fileciteturn209file0

## 5. Canonical delivery semantics

```text
Producer
  -> validate schema / authorization / tenant scope
  -> persist or enqueue authoritative event
  -> at-least-once delivery
  -> consumer dedupe
  -> ordered processing where required
  -> success / retry / DLQ
  -> observable evidence
```

Events propagate facts; they do not become a second source of truth. Platform Operations explicitly requires event identifiers, schema version, resource reference, correlation and deduplication strategy, while rejecting undocumented async paths. fileciteturn215file0

## 6. Canonical Job lifecycle

The existing Job state machine is authoritative:

`QUEUED -> RUNNING -> SUCCEEDED`

`QUEUED -> RUNNING -> FAILED -> QUEUED`

`QUEUED/RUNNING -> CANCELED`

Terminal states are `SUCCEEDED`, `FAILED`, and `CANCELED`; successful/canceled jobs cannot silently return to execution. Optimistic locking is required. fileciteturn197file0

No domain is allowed to invent a competing generic job lifecycle.

## 7. Reliability invariants

Every asynchronous capability must explicitly answer:

1. What is the authoritative source?
2. What happens on timeout?
3. Is retry bounded?
4. Is execution idempotent?
5. Can delivery be duplicated?
6. Can messages arrive out of order?
7. What is a poison message?
8. When does the message enter DLQ?
9. Who can replay it?
10. Does replay preserve the original event/task identity?
11. Can late completion overwrite newer state?
12. Can a projection be rebuilt without mutating business truth?
13. How is tenant/scope isolation enforced?
14. What evidence proves recovery?

If these answers are missing, the capability is not READY. This matches the platform operations admission gate. fileciteturn215file0

## 8. Media reuse confirmation

The existing Media Processing Instance Registry already defines:

- unique/idempotent enqueue;
- lease/lock-based claim;
- heartbeat;
- bounded retry/backoff;
- durable DLQ;
- replay;
- cancellation;
- projection rebuild;
- object/reference reconciliation.

It also explicitly forbids replay from resurrecting deleted media, duplicate processing from creating conflicting authority, and serving non-ready/quarantined/deleted media. Therefore these rules are **DIRECT-REUSE**, not candidates for redesign. fileciteturn213file0

## 9. Boundary rules

### EVENT owns

- event identity;
- schema/version metadata;
- delivery semantics;
- dedupe metadata;
- replay metadata;
- event routing metadata.

### JOB owns

- task execution state;
- attempts;
- scheduling;
- lease/heartbeat;
- retry/backoff;
- cancellation;
- DLQ/replay control.

### DOMAIN owns

- User state;
- Content state;
- Creator state;
- Rights state;
- Payment/Ledger state;
- Entitlement state;
- Advertising business facts;
- Media authoritative state.

### EVENT/JOB MUST NOT own

- user authorization truth;
- content publication truth;
- payment balance truth;
- rights ownership truth;
- recommendation truth;
- moderation final authority.

## 10. Cloudflare runtime mapping

The existing platform boundary remains:

```text
Request
  -> Worker
      -> D1 authoritative state
      -> R2 object state where applicable
      -> Cache/KV derived or hot state
      -> Queue asynchronous work
      -> Durable Object when strong coordination is required
      -> Workflows when durable multi-step execution is required
```

Queue/KV/cache are infrastructure or derived state. They cannot silently become business authority. fileciteturn215file0

## 11. Explicit rejection

The following 1.0 patterns are not allowed as independent 2.0 authorities:

- one global event registry duplicated by each business domain;
- queue state treated as business state;
- at-most-once assumptions on at-least-once infrastructure;
- unbounded automatic retries;
- retry without idempotency;
- replay that generates a new business fact instead of replaying an existing fact;
- DLQ records that cannot be audited or safely replayed;
- consumer-side rewriting of authoritative domain state without the domain contract;
- notification delivery becoming notification/business truth;
- analytics consumers rewriting source facts;
- local worker execution bypassing authorization;
- late asynchronous completion overwriting a newer state version;
- external queue/vendor schemas becoming permanent domain contracts.

## 12. R4 acceptance gate

R4 is considered reuse-closed when:

```text
Event contract
  -> Event registry / domain namespace
  -> Permission / tenant scope
  -> Idempotency
  -> Delivery semantics
  -> Job state
  -> Retry / timeout
  -> DLQ
  -> Replay
  -> Observability
  -> Test / CI
  -> Evidence
```

The repository already contains the contract-level assets for the majority of this chain. Implementation readiness still requires runtime implementation, tests, CI and evidence; this document does not claim those runtime gates are green.

## 13. R4 closure decision

**CLOSED at reuse/allocation level.**

No second generic Event Bus, Queue abstraction, Job authority, or retry architecture is authorized merely because 1.0 contained an implementation of it.

Future implementation proceeds only through:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence`

Next batch: **R5 — Advertising 1.0 reuse closure**.
