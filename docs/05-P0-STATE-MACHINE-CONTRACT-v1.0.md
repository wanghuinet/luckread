# State Machine Contract v1.0

**Status:** REQUIRED FOUNDATION CONTRACT

## 1. Scope

Every business entity with a lifecycle MUST define an explicit state machine before implementation. State changes MUST NOT be inferred from arbitrary field combinations.

## 2. State Definition

Each lifecycle MUST define:

- finite states;
- initial state;
- terminal states;
- permitted transitions;
- actor/permission required for each transition;
- transition preconditions;
- side effects/events;
- audit requirements;
- invalid-transition behavior.

## 3. Transition Model

Canonical form:

```text
current_state
    ↓
command/action
    ↓
permission + preconditions
    ↓
next_state
    ↓
side effects/domain event
```

Example content lifecycle:

```text
draft → reviewing → approved → scheduled → published
reviewing → rejected → draft
published → unpublished
published → archived
```

The exact states belong to the domain contract; the transition mechanism is standardized.

## 4. Transition Rules

A transition MUST be atomic with respect to the authoritative state change.

A transition MUST reject:

- unknown state;
- unsupported transition;
- missing permission;
- failed precondition;
- stale version when optimistic concurrency is required.

Invalid transitions return the common `INVALID_STATE` error contract.

## 5. Idempotency and Retries

Commands that can be retried MUST define idempotency semantics.

Repeated execution of an already-completed idempotent transition MUST NOT create duplicate authoritative side effects.

Non-idempotent commands MUST expose their conflict behavior explicitly.

## 6. Concurrency

State-changing operations MUST define concurrency protection where concurrent actors can race.

Acceptable mechanisms include:

- optimistic version check;
- transactional compare-and-set;
- equivalent authoritative concurrency control.

Last-write-wins MUST NOT silently overwrite a protected lifecycle transition when that could violate the state machine.

## 7. Events

Successful meaningful transitions SHOULD emit a versioned domain event containing:

```text
entity_id
actor_id
from_state
command
 to_state
event_id
event_version
timestamp
correlation_id
```

Event emission MUST NOT cause the authoritative state transition to be partially committed.

## 8. Payload Boundary

Payload drafts, versions, hooks and status fields may implement a state machine initially.

However, the domain contract MUST remain independent of Payload internals so the lifecycle can later be moved behind an application service without changing the public API.

## 9. Domain Requirements

Examples requiring explicit state machines include:

- Content publishing;
- IP verification/lifecycle;
- Creator verification;
- Comment moderation;
- Report/review/appeal;
- Media processing;
- MCN membership/contract status;
- Live session lifecycle;
- scheduled publication.

Simple metadata fields without lifecycle semantics do not require a state machine.

## 10. Acceptance Gate

A stateful business domain is not admitted unless it defines:

- states;
- initial/terminal states;
- legal transitions;
- permissions;
- preconditions;
- concurrency semantics;
- idempotency semantics;
- emitted events where applicable;
- invalid-transition errors;
- transition tests.
