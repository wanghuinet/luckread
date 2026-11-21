# P0 API Inventory Reconciliation Contract v1.0

## 1. Purpose

This contract converts the six-domain API inventory baseline into a machine-verifiable reconciliation gate. Inventory presence is not implementation evidence and must never by itself produce Production Green.

Covered domains:

- Auth
- User / Account
- Content
- Media
- Feed
- Interaction

## 2. Source of Truth

Public API truth is the Contract/OpenAPI layer. Payload collections, admin UI routes, service implementation and client code are implementation artifacts and MUST NOT silently create public endpoints.

The reconciliation chain is:

`Inventory → Schema → OpenAPI → Permission → Scope → State Machine → Cache Policy → Read/Write Classification → Resource Budget → RPC Budget → Retry Budget → Event Budget → Queue Budget → Anti-Abuse → Idempotency → Storage/Domain Mapping → Examples → Integration/E2E → Security E2E`

## 3. Required Machine-Readable Record

Every inventory operation MUST eventually have a stable record containing at minimum:

`domain, operationId, method, path, lifecycleStatus, auth, permission, scope, stateMachine, requestSchema, responseSchema, cachePolicy, readWriteClass, resourceBudget, rpcBudget, retryBudget, eventBudget, queueBudget, antiAbusePolicy, idempotencyPolicy, storageMapping, examples, evidence`

Missing fields are failures, not unknown values.

## 4. Status Model

- `INVENTORIED`: endpoint capability is recorded.
- `CONTRACTED_PARTIAL`: existing contract artifacts cover only part of the required chain.
- `CONTRACTED`: all contract dimensions are reconciled.
- `IMPLEMENTED`: runtime implementation exists and static gates pass.
- `INTEGRATED`: integration and dependency-boundary evidence exists.
- `STABLE`: production evidence and security evidence pass.
- `DEPRECATED`: replacement exists and migration policy is active.
- `REMOVED`: endpoint is no longer publicly available and removal evidence exists.

No status may skip required evidence.

## 5. Reconciliation Rules

### 5.1 Identity

`operationId` MUST be globally unique across the public API. Method + normalized path MUST map to at most one public operation.

### 5.2 Schema

Every request body, path parameter, query parameter and response projection MUST resolve to an explicit schema. Implicit Payload fields are forbidden.

### 5.3 Authorization

Every non-public operation MUST define permission and scope. Public operations MUST still define visibility policy, account-state constraints and resource eligibility where applicable.

### 5.4 State

Every mutation MUST reference a state machine when business state affects whether the operation is legal. Toggle operations MUST define atomic uniqueness/state behavior.

### 5.5 Resource Budget

Every operation MUST declare bounded D1 reads/writes, rows or bytes where applicable, RPC calls, CPU/wall-time class, response size, retry count and event/queue limits. A missing budget is a hard failure.

### 5.6 Cache

Every GET MUST explicitly declare `NO_STORE`, `PRIVATE`, `USER_SCOPED`, or `EDGE_PUBLIC` behavior. Shared caching is forbidden unless the response is explicitly public and its cache key contains all representation-changing dimensions.

### 5.7 Retry / Idempotency

Retry-safe mutations MUST define semantic idempotency. Transport-level `Idempotency-Key` requirements MUST be reconciled with the legacy operation policy rather than blindly enabling it on every mutation.

### 5.8 Events / Queue

Ordinary public requests MUST NOT synchronously fan out to downstream consumers. Async events and queues MUST have bounded count, depth, retries and DLQ/replay policy where applicable.

### 5.9 Anti-Abuse

Expensive mutations and high-amplification reads MUST define an anti-abuse policy before Production Green. Required scopes may include IP, device, account, endpoint, resource, tenant and global.

### 5.10 Evidence

The following are independent evidence dimensions:

`inventory, schema, openapi, permission, state, mapping, cache, resource, retry, event, queue, antiAbuse, examples, integration, e2e, securityE2E`

An absent evidence artifact is `FAIL`, not `UNKNOWN`.

## 6. Cross-File Reconciliation

The detailed domain policies under `contracts/api/*-operation-policy.v1.json` are inventory/policy inputs. They MUST eventually reconcile against:

- `contracts/openapi/v1/operation-policy.json`
- domain schemas
- permission contracts
- state-machine contracts
- storage/mapping manifests
- common response/error/cursor/idempotency contracts

If two artifacts disagree, CI MUST report a deterministic conflict and block Green. Manual preference without a recorded contract decision is forbidden.

## 7. Required Conflict Classes

CI MUST distinguish at least:

- `DUPLICATE_OPERATION_ID`
- `DUPLICATE_METHOD_PATH`
- `INVENTORY_NOT_IN_OPENAPI`
- `OPENAPI_NOT_IN_INVENTORY`
- `SCHEMA_MISSING`
- `PERMISSION_MISSING`
- `SCOPE_MISSING`
- `STATE_MACHINE_MISSING`
- `CACHE_POLICY_MISSING`
- `RESOURCE_BUDGET_MISSING`
- `IDEMPOTENCY_CONFLICT`
- `RETRY_POLICY_CONFLICT`
- `EVENT_POLICY_CONFLICT`
- `QUEUE_POLICY_CONFLICT`
- `ANTI_ABUSE_MISSING`
- `MAPPING_MISSING`
- `EVIDENCE_MISSING`

## 8. Green Rules

`Inventory Green` means all required operations are inventoried and conflict-free.

`Contract Green` requires Inventory Green plus complete Schema/OpenAPI/Permission/State/Mapping/Policy reconciliation.

`Production Green` additionally requires implementation, integration, E2E, security E2E, migration/release and runtime evidence.

Therefore:

`Inventory Green != Contract Green != Production Green`.

## 9. Six-Domain Completion Gate

The six core domains cannot advance to implementation-complete merely because every capability family has been listed. Before implementation status is promoted, the platform MUST produce a reconciliation report covering all six domains and all required evidence dimensions.

## 10. Explicit Anti-False-Green Rule

A generated report MUST fail closed when:

- an inventory operation has no OpenAPI mapping;
- an OpenAPI operation has no inventory record;
- a required schema/permission/state/mapping is absent;
- budgets are absent or unbounded;
- cache behavior is implicit;
- security E2E evidence is absent for security-sensitive operations;
- evidence JSON is malformed or missing.

## 11. Next Implementation Step

The next implementation artifact is `scripts/api-inventory-reconciliation-check.mjs`. It MUST consume the machine-readable inventory and contract files, emit deterministic JSON evidence, and be wired into Contract CI before any domain is declared Contract Green.
