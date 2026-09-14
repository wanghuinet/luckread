# Luckread 1.0 Reuse Closure — Batch R1 API / Contract Foundation v1.0

> Status: **CLOSED / REUSE ALLOCATED / CONTRACT FOUNDATION LOCKED**
>
> Scope: Reuse and consolidate high-value 1.0 API/contract assets into the 2.0 canonical API foundation. This batch does not introduce a second API authority and does not implement product business features.

## 1. Objective

Close the first 1.0 reuse batch by assigning reusable API/contract assets to the 2.0 canonical owners.

Implementation rule remains:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence`

## 2. Reuse disposition

| 1.0 asset | 2.0 canonical owner | Disposition | Rule |
|---|---|---|---|
| API Inventory | API | DIRECT-REUSE | Single inventory of externally observable operations |
| API Contract / operation definitions | API | DIRECT-REUSE | Contract-first source for implementation |
| API version registry | API / DEV | DIRECT-REUSE | Explicit version and compatibility policy |
| DTO / schema validation | API | MERGE | Reuse definitions; domain owns semantic validation |
| Stable error model | API | MERGE | One canonical error envelope and code registry |
| Pagination / cursor semantics | API | DIRECT-REUSE | Cursor semantics are contract-defined where applicable |
| Idempotency semantics | API / PAY / JOB | DIRECT-REUSE | Shared contract; domain-specific enforcement remains local |
| Trace / correlation identifiers | API / OBS | DIRECT-REUSE | Propagated across synchronous and asynchronous boundaries |
| Webhook registration / delivery contract | DEV / API | DIRECT-REUSE | Signed, replay-resistant, duplicate-safe delivery |
| Compatibility / deprecation policy | API / DEV | DIRECT-REUSE | No silent breaking changes |
| API documentation metadata | API / DEV | MERGE | Generated/published from canonical contract metadata |

## 3. Canonical authority rules

1. API is the canonical contract authority for externally exposed operations.
2. Domain services remain the authority for domain invariants and state transitions.
3. AUTHZ remains the authority for authorization; API validation must never become an authorization bypass.
4. PAY remains the financial authority; API idempotency does not replace financial transaction identity.
5. JOB remains the asynchronous execution authority; API requests may enqueue work but do not own job state.
6. Webhooks are delivery mechanisms, not domain truth.
7. Analytics consumes domain events and cannot become an API/domain truth source.
8. Client-specific adapters consume the same canonical API unless a documented client-specific capability exists.

## 4. Contract baseline

Every externally exposed operation must define, where applicable:

- stable operation identifier;
- HTTP/API method and resource semantics;
- authentication requirement;
- authorization permission and resource scope;
- request DTO/schema;
- response DTO/schema;
- stable error codes;
- pagination/cursor semantics;
- idempotency requirements;
- concurrency/conflict behavior;
- state-transition preconditions;
- event emission;
- audit requirements;
- rate-limit semantics;
- compatibility/version policy;
- deprecation policy.

## 5. Reuse vs refactor boundary

### DIRECT-REUSE

The following 1.0 assets are retained as canonical patterns:

- API inventory discipline;
- contract-first API definition;
- version registry;
- cursor/pagination contract;
- idempotency contract;
- trace/correlation propagation;
- webhook contract principles;
- compatibility/deprecation discipline.

### MERGE

The following are merged into 2.0 registries rather than copied as parallel files or implementations:

- DTO definitions;
- error definitions;
- API documentation metadata;
- operation-to-permission mapping;
- operation-to-event mapping.

### REFACTOR

Any 1.0 implementation that is tightly coupled to deprecated routes, old collection names, obsolete payload shapes, or temporary middleware is not copied verbatim. Its contract-level behavior may be retained while implementation is refactored behind the 2.0 boundary.

## 6. Explicit rejection

The following are not reusable as independent authorities:

- duplicate API registries;
- duplicate permission registries;
- route-local authorization systems;
- route-local wallet/payment state;
- webhook delivery as business truth;
- client-specific duplicate business APIs without a documented need;
- temporary compatibility patches presented as permanent contracts.

## 7. Acceptance gate

R1 is accepted only when a future implementation can trace:

`Feature ID -> API Contract -> Permission/Scope -> DTO -> Error -> State -> Event -> Audit -> Tests/CI`

For monetized operations:

`API -> Order/Transaction -> Entitlement -> Revenue Split -> Ledger -> Settlement -> Audit`

## 8. R1 closure decision

Batch R1 is **CLOSED** at the contract-allocation level.

No new API architecture is required from 1.0 reuse. Subsequent work moves to R2: Auth / AuthZ / Security reuse closure.

The project must not reopen a broad API audit unless CI, contract reconciliation, or implementation evidence identifies a concrete blocker.
