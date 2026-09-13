# P1 Observability Contract v1.0

## 1. Purpose

This contract defines the platform-wide observability model for API requests, Workers, asynchronous jobs, events, storage operations, authorization decisions, failures, and security-sensitive operations.

Observability MUST make a production incident traceable from an external request to the affected resource, operation, dependency, state transition, and resulting error without requiring unrestricted payload logging.

## 2. Core Principles

The platform MUST enforce:

- correlation across synchronous and asynchronous work;
- structured, machine-readable telemetry;
- stable identifiers;
- separation of logs, metrics, traces, and audit evidence;
- privacy-preserving telemetry;
- bounded cardinality;
- fail-safe observability behavior;
- explicit retention policies;
- actionable alerts rather than alert volume.

Observability MUST NOT become a hidden authorization or data-access bypass.

## 3. Canonical Request Context

Every externally initiated operation SHOULD establish a request context containing, where applicable:

- requestId;
- correlationId;
- traceId;
- actor/principal reference;
- organizationId;
- operation/action;
- resourceId;
- API route or operation name;
- service/worker identifier;
- deployment/version identifier.

`requestId` identifies one request. `correlationId` links related operations. `traceId` identifies a distributed execution trace.

IDs MUST be propagated across Worker-to-Worker calls, event publication, queue jobs, retries, and downstream operations when technically applicable.

## 4. Structured Logging

Application logs MUST be structured rather than dependent on free-form strings for machine processing.

A log record SHOULD contain:

- timestamp;
- severity;
- service;
- environment;
- requestId/correlationId when available;
- operation;
- result/status;
- error code when applicable;
- latency/duration when applicable;
- resource reference when safe;
- deployment version.

Logs MUST NOT contain passwords, access tokens, private keys, session secrets, or unnecessary private content.

Sensitive values MUST be redacted before logging, not merely hidden by presentation tooling.

## 5. Log Severity

At minimum the platform MUST distinguish:

- DEBUG: temporary diagnostic detail;
- INFO: normal operational milestones;
- WARN: degraded or unusual but recoverable behavior;
- ERROR: failed operation requiring investigation or recovery;
- FATAL/CRITICAL: service or integrity-threatening failure requiring immediate action.

Production DEBUG logging MUST be explicitly controlled and bounded.

## 6. Metrics

Critical components MUST expose metrics for:

- request count;
- success/error count;
- latency distributions;
- timeout count;
- retry count;
- idempotency conflict/in-progress outcomes;
- authorization deny/failure outcomes;
- state-transition failures;
- queue/job backlog and failure;
- event publication/consumption failures;
- storage errors;
- cache hit/miss where relevant;
- dependency failures;
- resource saturation where measurable.

Metrics SHOULD use bounded dimensions. User IDs, arbitrary content IDs, raw URLs, and unbounded payload values MUST NOT be used as metric labels.

## 7. Tracing

Distributed tracing SHOULD cover request paths that cross multiple Workers, asynchronous boundaries, or external dependencies.

Trace propagation MUST preserve correlation without requiring sensitive payload capture.

Sampling MUST NOT disable mandatory security/audit evidence.

Trace data MUST follow privacy and retention policies.

## 8. Audit Evidence

Audit records are distinct from ordinary logs.

Security- or rights-sensitive operations MUST create auditable evidence, including where applicable:

- authentication/security changes;
- role or entitlement changes;
- organization membership changes;
- ownership/right grants, revocations, and transfers;
- publication state changes;
- moderation actions;
- account suspension/ban/recovery/deletion;
- privacy/consent changes;
- financial/reward/subscription operations.

Audit evidence MUST identify actor, action, target, scope, outcome, timestamp, request/correlation reference, and relevant policy/state versions.

Audit records MUST NOT be silently deleted merely because ordinary application logs expired.

## 9. Error Contract Integration

Every externally visible error SHOULD map to a stable error code defined by the Error Contract.

Observability MUST record the stable error code rather than requiring parsing of human-readable messages.

Internal diagnostics MAY contain additional details, but public responses MUST respect privacy and authorization boundaries.

Repeated identical failures MUST be aggregatable without losing the underlying request correlation.

## 10. Latency and SLO Model

Critical API and background operations SHOULD define:

- availability objective;
- latency objective;
- error-rate objective;
- timeout budget;
- recovery expectation.

SLOs MUST be measured from observable production signals rather than manually asserted status.

Alerts SHOULD be based on sustained impact, error-budget consumption, integrity risk, or dependency failure—not isolated noisy events.

## 11. Health and Readiness

Services/Workers that require health reporting MUST distinguish:

- liveness: execution environment is functioning;
- readiness: operation can safely accept traffic;
- dependency health: required downstream capability is available;
- degraded mode: service remains available with explicitly reduced guarantees.

A health endpoint MUST NOT expose secrets, internal credentials, unrestricted configuration, or private data.

Health status MUST NOT falsely report success when a mandatory dependency or integrity invariant is unavailable.

## 12. Dependency Observability

Calls to D1, R2, Cache, queues, event systems, external APIs, and other dependencies SHOULD record:

- dependency name;
- operation class;
- duration;
- outcome;
- timeout/retry status;
- stable error classification.

Raw credentials, authorization headers, request bodies, and private payloads MUST NOT be logged.

## 13. Asynchronous Work

Jobs and event consumers MUST preserve sufficient context to answer:

`who initiated it -> what operation -> which resource -> which attempt -> what dependency -> what result`

Retries MUST increment an attempt indicator and retain the original correlation/reference identifiers.

Dead-letter/poison work MUST be observable and alertable.

Replay MUST be distinguishable from ordinary execution.

## 14. Authorization Observability

Authorization decisions SHOULD emit privacy-safe evidence containing:

- principal reference;
- requested action;
- resource/scope reference;
- decision: allow/deny;
- policy version;
- relevant account/role/organization versions where applicable;
- reason code.

The system MUST NOT log full tokens, credentials, or unnecessary personal data merely to explain an authorization decision.

Sensitive authorization failures MUST remain fail-closed even when observability infrastructure is degraded.

## 15. Privacy and Consent Integration

Observability MUST follow the Privacy and Consent Contract.

Telemetry MUST minimize personal data and MUST NOT become an undeclared analytics channel.

Consent withdrawal or privacy restrictions MUST be respected by telemetry pipelines where applicable.

Sensitive content MUST NOT be copied into logs or traces as a debugging shortcut.

## 16. Alerting

Alerts MUST have:

- stable alert identity;
- severity;
- affected component;
- trigger condition;
- evidence source;
- owner/escalation target;
- recovery condition.

Critical alerts SHOULD cover, at minimum:

- elevated 5xx/error rate;
- sustained latency breach;
- authorization integrity failures;
- event/outbox delivery failure;
- queue backlog or poison messages;
- storage unavailability;
- repeated dependency timeout;
- data lifecycle reconciliation failure;
- rights/ownership integrity failure;
- security/privacy incident indicators.

## 17. Cardinality and Cost Controls

Telemetry MUST be designed with bounded cost.

Unbounded user/resource identifiers MUST NOT be emitted as metric dimensions.

High-volume logs SHOULD be sampled, aggregated, or rate-limited where doing so does not destroy required audit/security evidence.

Observability storage MUST have explicit retention and deletion policies.

## 18. Failure of Observability

Failure of logging, tracing, metrics, or alert delivery MUST NOT cause ordinary business requests to become insecure or corrupt data unless the operation explicitly requires durable audit evidence.

Operations requiring mandatory audit evidence MUST fail closed or enter an explicitly defined safe state if the required evidence cannot be durably recorded.

This distinction MUST be encoded in the operation contract.

## 19. Reconciliation and Integrity Signals

The platform SHOULD expose observable signals for cross-system reconciliation, including:

- missing or orphaned R2 objects;
- stale indexes/cache entries;
- missing events;
- stuck jobs;
- lifecycle inconsistencies;
- rights/ownership mismatches;
- authorization-version mismatches.

Integrity signals MUST be actionable and linkable to the relevant correlation/resource references.

## 20. Machine-Readable Alignment

Observability vocabulary MUST remain aligned with Common, Error, Request-ID, Event, Idempotency, Authorization, Lifecycle, Privacy, and OpenAPI contracts.

Canonical fields SHOULD include:

`requestId`, `correlationId`, `traceId`, `operation`, `resourceId`, `actorId`, `organizationId`, `status`, `errorCode`, `durationMs`, `attempt`, `policyVersion`, `deploymentVersion`.

Domain-specific telemetry MUST NOT invent conflicting meanings for these fields.

## 21. Acceptance Criteria

- [ ] Request/correlation/trace identifiers have defined semantics.
- [ ] Structured logging is mandatory for production services.
- [ ] Secrets and unnecessary private data are excluded from telemetry.
- [ ] Critical operations expose actionable metrics.
- [ ] Metrics dimensions remain bounded.
- [ ] Distributed execution preserves correlation context.
- [ ] Security/rights-sensitive operations create audit evidence.
- [ ] Audit evidence is separated from ordinary logs.
- [ ] Errors map to stable error codes.
- [ ] Critical operations have measurable SLO/alert signals.
- [ ] Health and readiness semantics are explicit.
- [ ] Dependency failures are observable without leaking credentials.
- [ ] Async retries/replays preserve execution context.
- [ ] Authorization observability remains privacy-safe and fail-closed.
- [ ] Observability follows privacy/consent rules.
- [ ] Alert definitions have ownership and recovery conditions.
- [ ] Telemetry has explicit retention/cost controls.
- [ ] Mandatory audit evidence has a defined failure behavior.
- [ ] Cross-store integrity failures are detectable.
- [ ] Machine-readable contracts use consistent observability vocabulary.
