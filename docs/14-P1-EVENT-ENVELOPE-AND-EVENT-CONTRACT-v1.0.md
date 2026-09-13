# P1 Event Envelope and Event Contract v1.0

## 1. Purpose

This contract defines the canonical event envelope for Luckread platform events.

It provides one stable event model for domain changes, asynchronous processing, audit integration, cache invalidation, notifications, analytics, moderation, recommendation pipelines, and future integrations.

This is a P1 platform contract. Domain documents MUST NOT create incompatible event envelopes.

## 2. Event Principles

Events MUST be:

- immutable after publication;
- uniquely identifiable;
- versioned;
- attributable to an actor/principal or explicit system source;
- correlated with the originating request when applicable;
- scoped to a tenant/organization/resource when applicable;
- safe to retry;
- explicit about schema version and event time;
- independent of UI implementation.

An event describes a fact that occurred. It MUST NOT be used as an implicit authorization grant.

## 3. Canonical Envelope

Every platform event MUST conceptually contain:

- `eventId` — globally unique event identifier;
- `eventType` — stable dotted event name;
- `eventVersion` — schema version of the event payload;
- `occurredAt` — source occurrence timestamp;
- `publishedAt` — publication timestamp when available;
- `producer` — stable producer/service identifier;
- `source` — source resource/domain identifier;
- `actor` — authenticated principal or explicit system actor;
- `requestId` — originating request identifier when applicable;
- `correlationId` — workflow/cross-service correlation identifier;
- `causationId` — immediate preceding event/command identifier when applicable;
- `organizationId` — organization scope when applicable;
- `resource` — affected resource identity and type when applicable;
- `data` — versioned event-specific payload;
- `metadata` — non-authoritative tracing/processing metadata.

## 4. Identity and Ordering

`eventId` MUST be unique and immutable.

Consumers MUST NOT assume global ordering across all events.

Ordering MAY be guaranteed only within an explicitly defined ordering key, such as a resource or aggregate identifier.

If ordering matters, the event contract MUST expose an explicit sequence/version field. Consumers MUST detect gaps where the producer contract requires contiguous sequencing.

## 5. Event Types

Event names MUST use stable dotted vocabulary, for example:

- `account.created`
- `account.state.changed`
- `content.created`
- `content.updated`
- `content.published`
- `content.unpublished`
- `content.deleted`
- `comment.created`
- `comment.moderated`
- `reaction.created`
- `follow.created`
- `ip.created`
- `ip.rights.changed`
- `rights.granted`
- `rights.revoked`
- `organization.membership.changed`

Event names MUST describe facts, not commands. `content.publish` is a command/permission concept; `content.published` is an event fact.

## 6. Actor and Authorization Boundary

The event MUST identify the actor that caused the state change when one exists.

System-generated events MUST identify an explicit system actor/source.

Consumers MUST NOT treat `actor` fields as proof that the original operation was authorized. Authorization is evaluated at command/API execution time; events record the resulting fact and evidence needed for audit.

Sensitive events SHOULD carry the relevant authorization/policy version references without embedding secrets or credentials.

## 7. Resource and Scope

Events affecting protected resources MUST identify the resource type and stable resource identifier where applicable.

Organization-scoped events MUST carry organization context.

Rights-bearing events MUST preserve sufficient scope information to distinguish resource, organization, IP, channel, territory, locale, or other applicable boundaries.

## 8. Payload Versioning

`eventVersion` MUST be explicit.

Backward-compatible additions SHOULD preserve the existing major event version according to the schema compatibility policy.

Breaking payload changes MUST create a new incompatible version and MUST NOT silently reinterpret an existing version.

Consumers MUST reject unsupported incompatible versions deterministically rather than guessing.

## 9. Idempotency and Delivery

Event delivery MUST be treated as at-least-once unless a specific infrastructure contract proves a stronger guarantee.

Consumers MUST be idempotent using `eventId` and, where required, an explicit consumer/processing key.

Duplicate delivery MUST NOT cause duplicate irreversible side effects.

The Event Contract defines event identity; the separate Idempotency Contract defines command/API idempotency semantics.

## 10. Transactional Publication

For state-changing operations that require reliable event emission, the implementation MUST prevent the following invalid state:

`business state committed + required event permanently lost`

The chosen persistence/dispatch mechanism MUST provide an explicit durability strategy, such as transactional outbox or an equivalent contractually proven mechanism.

An event MUST NOT be published as successfully durable before the required source state is durably committed.

## 11. Retry and Failure

Consumers MUST tolerate retries and transient reordering within their documented ordering model.

Poison events MUST enter a controlled failure path rather than causing unbounded retry loops.

Retry policy, backoff, timeout, dead-letter handling, and replay semantics are governed by the Dependency Reliability and Event Processing contracts and MUST be explicit before production admission.

## 12. Privacy and Security

Events MUST contain the minimum data required for their consumers.

Secrets, passwords, access tokens, session credentials, payment credentials, and unnecessary sensitive personal data MUST NOT be included.

Deletion/privacy workflows MUST define how event history is retained, redacted, tombstoned, or access-controlled without corrupting audit integrity.

## 13. Replay

Events intended for replay MUST be immutable and versioned.

Replay MUST be distinguishable from live processing in operational metadata where required.

Replay MUST NOT bypass current authorization controls for administrative access to event data.

Consumers MUST define whether processing historical events is safe under current business rules. If not, the consumer MUST use explicit historical-version semantics rather than silently applying new rules.

## 14. Audit Relationship

Security-sensitive events SHOULD be sufficient to correlate a state change with:

- actor;
- requestId/correlationId;
- target resource;
- action/fact;
- timestamp;
- relevant policy/version references;
- result.

The event stream is not automatically the authoritative audit ledger. Audit retention and immutability requirements remain governed by the audit/data-lifecycle contract.

## 15. Consumer Contract

Every durable consumer MUST define:

- accepted event types/versions;
- ordering assumptions;
- idempotency key;
- retry behavior;
- poison-event behavior;
- dead-letter behavior;
- replay behavior;
- maximum processing time;
- observable success/failure metrics.

A consumer MUST fail closed where processing would create an unsafe security or rights decision.

## 16. Machine-Readable Alignment

The canonical envelope SHOULD be represented in JSON Schema and referenced by OpenAPI/event-specific schemas.

Required vocabulary MUST remain stable across implementation and documentation:

`eventId`, `eventType`, `eventVersion`, `occurredAt`, `producer`, `actor`, `requestId`, `correlationId`, `causationId`, `organizationId`, `resource`, `data`.

Domain event schemas MUST define their payload under `data` and MUST NOT redefine envelope fields with conflicting meanings.

## 17. Acceptance Criteria

This contract is implementation-ready when:

- [ ] Canonical envelope fields are machine-readable.
- [ ] Event identity and versioning are explicit.
- [ ] Actor, request, correlation, and resource context are defined.
- [ ] Ordering assumptions are explicit rather than implied globally.
- [ ] At-least-once delivery and consumer idempotency are explicit.
- [ ] Transactional publication/durability semantics are defined.
- [ ] Retry, poison-event, and replay boundaries are defined.
- [ ] Privacy/security data-minimization rules are defined.
- [ ] Event and command semantics are not conflated.
- [ ] Domain events can reference the canonical envelope without semantic duplication.
- [ ] Contract CI can validate the required envelope vocabulary and invariants.
