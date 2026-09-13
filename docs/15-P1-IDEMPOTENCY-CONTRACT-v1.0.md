# P1 Idempotency Contract v1.0

## 1. Purpose

This contract defines deterministic duplicate-request protection for Luckread APIs and commands.

It applies to operations where retries, network timeouts, client re-submission, worker retries, or concurrent requests could otherwise create duplicate state or duplicate side effects.

## 2. Core Invariant

For an operation declared idempotent, repeating the same logical request with the same idempotency key MUST NOT create an additional successful side effect.

The platform MUST distinguish:

- duplicate request;
- concurrent same-key request;
- same key with different request payload;
- retry after completed success;
- retry after completed failure;
- unknown outcome after timeout.

## 3. Idempotency Key

Idempotent write APIs SHOULD accept a client-generated `Idempotency-Key` with bounded length and character constraints.

The key MUST be scoped by at least:

- authenticated principal;
- operation/endpoint;
- idempotency namespace.

A raw key MUST NOT be globally reusable across unrelated principals or operations.

For unauthenticated operations, the contract MUST define an alternative trust boundary before enabling idempotency.

## 4. Request Fingerprint

The server MUST derive a canonical request fingerprint from the semantically relevant request inputs.

For a previously completed key:

- same fingerprint → return the original logical result according to the operation contract;
- different fingerprint → reject with a deterministic idempotency conflict error.

The server MUST NOT rely on JSON property order or incidental serialization differences when computing the fingerprint.

Secrets and unnecessary sensitive fields MUST NOT be persisted in the fingerprint record.

## 5. State Machine

An idempotency record MUST have explicit lifecycle states sufficient to distinguish processing from completion. A canonical minimum is:

`IN_PROGRESS → SUCCEEDED`

`IN_PROGRESS → FAILED_RETRYABLE`

`IN_PROGRESS → FAILED_FINAL`

Expired/stale processing records MAY transition to a recoverable state according to the timeout/recovery contract.

A consumer/client MUST NOT assume that an unknown result means the operation did not happen.

## 6. Concurrent Requests

Concurrent requests using the same scoped idempotency key MUST converge on one logical operation.

Exactly one request MAY own execution of the operation at a time.

Other requests MUST either:

- wait for the owner according to a bounded timeout; or
- receive a deterministic in-progress response and retry according to the API contract.

A race MUST NOT produce duplicate durable side effects.

## 7. Response Replay

After successful completion, a retry with the same key and matching fingerprint SHOULD return the same logical outcome.

For APIs where replaying the full response is unsafe or impractical, the contract MUST define a stable operation/result identifier that the client can use to retrieve the original outcome.

The implementation MUST NOT report a newly created resource as a second successful result for a duplicate request.

## 8. Failure Semantics

A retryable failure MAY be retried using the same key if the contract permits it.

A final failure MUST have deterministic semantics for subsequent requests.

If the outcome is unknown because the client lost the response after the server committed, the client MUST retry with the same key rather than generating a new key.

The platform MUST NOT advise clients to create a new key merely because the previous response timed out.

## 9. Side-Effect Boundary

Idempotency MUST cover the complete logical operation, not only one database insert.

Operations that can trigger secondary effects MUST define deduplication for those effects, including where applicable:

- event publication;
- notifications;
- reward/ledger changes;
- media processing jobs;
- moderation jobs;
- cache invalidation;
- external provider calls.

An idempotent API MUST NOT become non-idempotent because a downstream side effect is retried independently.

## 10. Database and Persistence

The idempotency record MUST have a uniqueness constraint matching its declared scope.

The implementation MUST use an atomic create/claim mechanism so two concurrent requests cannot both become owners.

The idempotency record and the authoritative state mutation MUST have a defined consistency boundary.

If a distributed transaction is unavailable, the design MUST explicitly use an outbox/state-machine/reconciliation strategy rather than assuming atomicity.

## 11. TTL and Retention

Every idempotency namespace MUST define a retention period appropriate to its business risk.

TTL MUST NOT be shorter than the maximum client retry window when doing so could permit a dangerous duplicate operation.

High-risk operations SHOULD use longer retention or durable operation records instead of relying only on short-lived cache entries.

Expiration MUST NOT silently allow a duplicate irreversible side effect when the original operation may still be validly retried.

## 12. API Errors

The API MUST use the common error contract for idempotency failures.

At minimum, implementations SHOULD distinguish:

- `IDEMPOTENCY_CONFLICT` — same key, different request;
- `IDEMPOTENCY_IN_PROGRESS` — another request currently owns execution;
- `IDEMPOTENCY_EXPIRED` — retry is outside the supported retention window;
- `IDEMPOTENCY_UNAVAILABLE` — the idempotency authority cannot safely determine ownership.

When idempotency state cannot be safely evaluated for a protected operation, the operation MUST fail closed rather than execute without duplicate protection.

## 13. High-Risk Operations

Idempotency MUST be mandatory or equivalently enforced for operations with irreversible or financially/security sensitive side effects, including as applicable:

- account creation or provisioning;
- password/reset token issuance workflows;
- content publication workflows;
- rights grant/revoke/transfer;
- organization membership changes;
- reward/ledger mutations;
- paid/subscription mutations;
- media ingestion job creation;
- bulk mutations.

The exact endpoint inventory MUST be maintained in machine-readable API metadata rather than inferred by clients.

## 14. Bulk Operations

Bulk APIs MUST define whether the idempotency key represents:

- the complete batch; or
- each individual item.

The contract MUST define partial success, retry, ordering, and result correlation.

A retried batch MUST NOT duplicate already committed items.

## 15. Security

Idempotency records MUST be access-controlled and MUST NOT become a side channel for another principal to discover request contents or resource existence.

Keys SHOULD be treated as opaque secrets from logging perspective and MUST NOT be unnecessarily exposed in analytics or audit streams.

Authorization MUST be evaluated for the current request even when an old result is replayed, unless the API contract explicitly defines a safe historical-result retrieval path.

## 16. Event Integration

For an idempotent state-changing operation, the canonical event contract MUST be tied to the logical operation so retries do not publish duplicate authoritative facts.

Where an outbox is used, the outbox/event identity MUST be stable for the logical operation or otherwise deduplicated by a deterministic operation identifier.

## 17. Observability

The platform SHOULD expose metrics for:

- idempotency hit rate;
- conflicts;
- concurrent in-progress requests;
- stale records;
- replayed successes;
- retryable/final failures;
- unavailable idempotency authority.

Logs MUST contain correlation/request identifiers while avoiding raw sensitive payloads and secrets.

## 18. Machine-Readable Alignment

The contract SHOULD be represented in JSON Schema/OpenAPI metadata with stable vocabulary including:

`Idempotency-Key`, `idempotencyKey`, `requestFingerprint`, `idempotencyState`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`.

The OpenAPI contract MUST identify which operations require idempotency rather than leaving this requirement only in prose.

## 19. Acceptance Criteria

- [ ] Idempotency scope is explicit.
- [ ] Request fingerprinting is canonical and deterministic.
- [ ] Same-key/different-payload conflicts are deterministic.
- [ ] Concurrent same-key execution converges to one logical operation.
- [ ] Success replay semantics are defined.
- [ ] Unknown outcome after timeout is safe to retry.
- [ ] Complete side-effect boundaries are covered.
- [ ] Persistence uniqueness/atomic claim semantics are defined.
- [ ] TTL is risk-appropriate.
- [ ] High-risk operations are enumerated in machine-readable metadata.
- [ ] Bulk mutation semantics are explicit.
- [ ] Authorization remains enforced on retries/replays.
- [ ] Event publication cannot duplicate the authoritative fact.
- [ ] Contract CI can validate required idempotency vocabulary and invariants.
