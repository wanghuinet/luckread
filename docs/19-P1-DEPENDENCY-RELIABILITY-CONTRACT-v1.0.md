# P1 Dependency Reliability Contract v1.0

## 1. Purpose

This contract defines reliability boundaries for calls between Workers and dependencies including D1, R2, Cache, queues/events, Payload services, and external providers.

The goal is to prevent cascading failure, retry amplification, partial side effects, silent data loss, and unsafe degradation.

## 2. Core Principles

The platform MUST enforce:

- explicit dependency classification;
- bounded timeouts;
- bounded retries;
- retry safety based on operation semantics;
- exponential backoff with jitter where retries are allowed;
- circuit breaking or equivalent admission control for unstable dependencies;
- fail-fast behavior for non-recoverable failures;
- explicit degraded-mode behavior;
- no silent loss of authoritative writes;
- observability for every dependency failure;
- recovery and reconciliation after partial failure.

A dependency failure MUST NOT be converted into a false success.

## 3. Dependency Classes

Each dependency MUST be classified as one of:

- authoritative: required for correctness of the current operation;
- required: operation cannot safely complete without it;
- recoverable: failure may be retried or completed asynchronously;
- derived: failure may temporarily reduce freshness without losing authority;
- optional: failure may be safely ignored or degraded.

Examples:

- authoritative D1 write: correctness-critical;
- R2 object referenced by authoritative metadata: correctness-critical for completion semantics;
- cache: derived;
- search/index projection: derived;
- notification delivery: recoverable/derived depending on operation;
- analytics: optional/derived unless explicitly elevated by a contract.

Every new external dependency MUST declare its class before production use.

## 4. Timeout Contract

Every dependency call MUST have a bounded timeout.

Timeouts MUST be shorter than the enclosing operation's deadline and MUST leave sufficient budget for response handling, retries, persistence, and cleanup.

A retry MUST NOT restart an operation after the overall request deadline has been exhausted.

Timeouts MUST be observable with a stable classification such as `DEPENDENCY_TIMEOUT`.

## 5. Retry Contract

Retries are permitted only when the operation is known to be safe to retry or is protected by idempotency/equivalent deduplication.

The retry policy MUST define:

- maximum attempts;
- backoff strategy;
- jitter;
- retryable error classes;
- overall deadline;
- whether the operation is read/write/side-effecting;
- recovery behavior after unknown outcome.

Blind retries of non-idempotent writes are forbidden.

The system MUST NOT retry authentication failures, authorization denials, validation failures, deterministic conflicts, or other explicitly non-retryable errors.

## 6. Backoff and Retry Budget

Retries MUST be bounded by both attempt count and time budget.

Exponential or equivalent backoff with jitter SHOULD be used for transient dependency failures.

The system MUST prevent retry storms and multiplicative retry amplification across dependency layers.

Nested components MUST NOT each independently perform unbounded retries for the same logical operation.

## 7. Idempotency Integration

All retryable side-effecting operations MUST integrate with the Idempotency Contract.

For an unknown outcome, the caller MUST retry using the same logical idempotency identity rather than generating a new operation.

A dependency retry MUST NOT create duplicate:

- authoritative records;
- events;
- notifications;
- rewards/ledger effects;
- media jobs;
- ownership/right changes;
- subscription/payment effects.

## 8. Circuit Breaking

Dependencies exhibiting sustained failure, timeout, or saturation SHOULD enter an explicitly observable degraded state.

A circuit breaker or equivalent mechanism MUST define:

- failure threshold;
- evaluation window;
- open duration;
- half-open/probe behavior;
- recovery condition;
- fail-fast response.

Circuit state MUST NOT bypass authorization, lifecycle, or data-integrity checks.

## 9. Bulkhead and Concurrency Isolation

A single unhealthy dependency MUST NOT consume the entire execution capacity of unrelated operations.

Where practical, the platform SHOULD isolate:

- critical writes;
- reads;
- asynchronous jobs;
- notifications;
- analytics;
- media processing;
- administrative operations.

Concurrency limits MUST be explicit where dependency saturation can cascade into platform-wide failure.

## 10. Dependency Ordering

Operations spanning multiple dependencies MUST define their side-effect ordering.

The platform MUST identify which system is authoritative and which systems are projections or derived outputs.

A derived-system failure MUST NOT cause an authoritative operation to be reported as successfully completed if the contract requires synchronous completion of that derived effect.

Conversely, an optional/derived dependency MUST NOT unnecessarily block an authoritative operation.

## 11. D1 Reliability

D1 operations MUST distinguish reads, authoritative writes, and reconciliation.

Write failures or unknown outcomes MUST NOT be silently treated as successful writes.

Read-after-write behavior MUST be defined for operations requiring immediate consistency.

Cross-D1 operations MUST NOT assume distributed transactions.

When multiple D1 databases participate in one logical operation, the contract MUST define:

- authoritative store;
- write ordering;
- compensating action or reconciliation;
- idempotency identity;
- failure visibility.

## 12. R2 Reliability

R2 object operations MUST define whether the object or metadata is authoritative for each workflow.

Metadata MUST NOT permanently reference an object whose required upload has not completed.

Object upload retry MUST be idempotent or use unique object-operation identities.

Failed or abandoned objects MUST be detectable by reconciliation/cleanup jobs.

Deletion MUST follow the Data Lifecycle Contract and MUST NOT be triggered by a stale retry.

## 13. Cache Reliability

Cache is derived unless a domain contract explicitly states otherwise.

Cache failure MUST NOT cause authoritative data loss.

Cache reads MUST tolerate misses and stale entries according to endpoint semantics.

Cache invalidation failures MUST be observable and recoverable.

A stale cache MUST NOT resurrect deleted, restricted, banned, or otherwise inaccessible resources.

## 14. Queue and Event Reliability

Queue/event publication for correctness-critical operations MUST use durable publication semantics such as an outbox or equivalent contract.

Consumers MUST be idempotent and tolerate at-least-once delivery.

A failed consumer MUST retry only according to bounded policy.

Poison messages MUST be isolated and observable rather than retried indefinitely.

Replay MUST preserve event identity and remain subject to current consumer safety rules.

## 15. External Services

External providers MUST be treated as unreliable dependencies by default.

Each integration MUST define:

- timeout;
- retry policy;
- authentication failure behavior;
- rate-limit behavior;
- circuit/degraded mode;
- data-sharing scope;
- privacy requirements;
- fallback behavior;
- reconciliation where side effects are involved.

Provider success MUST NOT be assumed merely because a network request completed without transport error.

## 16. Graceful Degradation

Every critical endpoint SHOULD explicitly define its degraded behavior.

Examples:

- cache unavailable → read authoritative data;
- recommendation unavailable → deterministic fallback feed;
- notification unavailable → durable retry;
- analytics unavailable → accept authoritative request and queue later processing;
- search index unavailable → use authoritative metadata where supported.

Degradation MUST NOT bypass authorization, ownership, privacy, lifecycle, or state-machine rules.

## 17. Failure Classification

Dependency errors MUST be classified at minimum as:

- timeout;
- transient/unavailable;
- rate limited;
- authentication failure;
- authorization failure;
- validation/schema failure;
- conflict;
- permanent failure;
- unknown outcome.

Only explicitly retryable classes may enter retry logic.

## 18. Unknown Outcome

When a side-effecting dependency call times out after transmission may have occurred, the caller MUST treat the result as unknown rather than as failure-with-certainty.

Recovery MUST use idempotency, status lookup, reconciliation, or an equivalent mechanism before issuing a potentially duplicating operation.

The system MUST NOT create a second logical operation merely because the first outcome is unknown.

## 19. Recovery

Recovery MUST be explicit and observable.

Recovery mechanisms SHOULD include:

- retry with bounded policy;
- status reconciliation;
- compensating operation where safe;
- dead-letter processing;
- cache/index rebuild;
- orphan cleanup;
- replay of durable events;
- manual intervention for exceptional integrity failures.

Recovery MUST verify current resource version/state before applying delayed work.

## 20. Cascading Failure Protection

The platform MUST prevent:

- unbounded retry multiplication;
- dependency timeout occupying all execution capacity;
- one dependency outage taking down unrelated features;
- stale recovery overwriting newer state;
- failed optional dependencies blocking authoritative writes;
- circuit-breaker fallback exposing unauthorized data.

Critical paths MUST have bounded total execution time.

## 21. Dependency Version and Contract Compatibility

Dependency clients MUST validate the contract version expected by the caller where versioning is relevant.

Schema incompatibility MUST fail explicitly rather than silently coercing unsafe data.

Backward-compatible changes MUST remain within the declared contract; breaking changes require versioned migration.

## 22. Observability Integration

Every dependency call SHOULD expose:

- dependency name;
- operation;
- duration;
- attempt;
- timeout/retry status;
- circuit state where applicable;
- stable error class;
- request/correlation/trace references.

Telemetry MUST follow the Privacy and Observability Contracts.

## 23. Cost and Capacity Protection

Reliability controls MUST account for cost and capacity.

Retries, polling, reconciliation, and background recovery MUST have explicit limits.

A dependency outage MUST NOT cause uncontrolled increases in Workers executions, D1 queries, R2 operations, queue messages, or external API calls.

## 24. Machine-Readable Alignment

Dependency policies MUST be expressible in machine-readable configuration or contract metadata where implementation requires them.

Canonical vocabulary SHOULD include:

`dependencyClass`, `timeoutMs`, `maxAttempts`, `retryableErrors`, `backoff`, `jitter`, `deadlineMs`, `circuitState`, `fallback`, `unknownOutcomePolicy`, `reconciliationPolicy`.

These semantics MUST align with Idempotency, Event, Lifecycle, Authorization, Privacy, Error, and Observability contracts.

## 25. Acceptance Criteria

- [ ] Every dependency has an explicit reliability class.
- [ ] Every dependency call has a bounded timeout.
- [ ] Retry policy is explicit and bounded.
- [ ] Non-idempotent writes are never blindly retried.
- [ ] Retry amplification is prevented.
- [ ] Circuit breaking or equivalent protection is defined for unstable dependencies.
- [ ] Critical workloads have concurrency/bulkhead protection where needed.
- [ ] Authoritative and derived stores are explicitly distinguished.
- [ ] Cross-D1 operations do not assume distributed transactions.
- [ ] R2 metadata/object consistency has defined failure behavior.
- [ ] Cache failures cannot cause data loss or unauthorized resurrection.
- [ ] Event/queue processing is durable, bounded, and idempotent.
- [ ] External integrations define timeout, retry, rate-limit, privacy, and fallback behavior.
- [ ] Every critical feature defines safe degraded behavior.
- [ ] Unknown outcomes have explicit recovery semantics.
- [ ] Recovery verifies current resource state/version.
- [ ] Cascading failure protections are explicit.
- [ ] Dependency contract compatibility is validated.
- [ ] Dependency failures are observable.
- [ ] Reliability controls have cost/capacity bounds.
- [ ] Machine-readable reliability vocabulary is consistent across contracts.
