# P0 — Capability Contract Graph v1.0

**Status:** NOT GREEN / FOUNDATION LOCKED

## 1. Purpose

This contract establishes the machine-verifiable relationship between the active functional blueprint and all downstream engineering contracts. It prevents the functional blueprint, API contracts, domain models, persistence models, permissions, state machines, events, queues, caches, and evidence from becoming independent systems.

## 2. Canonical source

The active functional source of truth is:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

Older L1/L2/L3/L4 matrices and historical documents are reference material only. They MUST NOT be silently promoted to a competing source of truth. The repository already records the v2.0 blueprint as the current functional master inventory and requires a stable Feature ID before implementation.

## 3. Contract graph

```text
Blueprint L1-L4
      ↓
Feature ID
      ↓
Capability Owner / Domain
      ↓
Business Object
      ↓
API Contract ── OpenAPI / DTO
      ↓
Domain Contract
      ↓
Persistence Contract ── Payload / DB
      ↓
Permission / Scope
      ↓
State Machine
      ↓
Event / Queue / Cache
      ↓
Integration / E2E / Security Evidence
```

Every edge must be machine-resolvable. A missing edge is not UNKNOWN; it is a reconciliation failure unless the feature is explicitly marked as not requiring that projection.

## 4. Feature identity

Every capability has exactly one stable `featureId`. Feature IDs are never reused for a different capability. Removal is represented by lifecycle state and dependency cleanup, not silent identifier reuse.

## 5. Required feature record

The machine-readable registry at `contracts/capability/capability-contract-graph.v1.json` must resolve, where applicable:

- L1/L2/L3/L4 hierarchy
- feature name and description
- canonical owner
- business object
- lifecycle/status
- exposure class
- API operation IDs
- domain entity IDs
- persistence mapping IDs
- permission IDs
- scope IDs
- state machine ID
- event IDs
- queue/job IDs
- cache policy ID
- dependencies
- evidence IDs

The JSON Schema is `contracts/capability/capability-contract-graph.v1.schema.json`.

## 6. Non-negotiable invariants

1. No implementation without a Feature ID.
2. No public API without a Feature ID.
3. No Feature may have multiple canonical owners.
4. No business persistence mapping may be unowned.
5. No permission may reference a removed feature.
6. No state transition may reference a removed feature.
7. No event/queue contract may reference a removed feature.
8. No API operation may become a second business owner.
9. Payload implementation fields do not automatically become public API fields.
10. Cloudflare infrastructure remains an implementation boundary; domain and persistence contracts must remain portable to PostgreSQL/GCP.

## 7. Change protocol

### Add

`Proposal → Feature ID → Impact Analysis → Contract → CI → Implementation → Evidence`

### Modify

`Existing Feature → Impact Analysis → Contract Diff → Breaking-change Check → CI → Implementation → Evidence`

### Deprecate

`Deprecation Proposal → Dependency Scan → Migration Plan → Deprecation State → CI → Removal Evidence`

### Remove

Removal is permitted only when all downstream references are resolved or explicitly classified as historical evidence.

## 8. Drift classes

The validator must fail closed for:

- `DUPLICATE_FEATURE_ID`
- `INCOMPLETE_L1_L4_HIERARCHY`
- `MULTIPLE_CANONICAL_OWNERS`
- `API_WITHOUT_FEATURE`
- `FEATURE_WITHOUT_REQUIRED_CONTRACT`
- `DOMAIN_MAPPING_MISSING`
- `PERSISTENCE_MAPPING_MISSING`
- `UNOWNED_DB_MAPPING`
- `PERMISSION_DRIFT`
- `STATE_DRIFT`
- `EVENT_DRIFT`
- `QUEUE_DRIFT`
- `ORPHAN_REFERENCE`
- `BREAKING_CONTRACT_CHANGE`
- `EVIDENCE_MISSING`

## 9. Green model

`Capability Inventory Green` means the active blueprint has been reconciled into stable Feature IDs.

`Capability Contract Green` means every applicable downstream contract edge is resolved and the graph validator passes.

`Production Green` remains a separate state requiring implementation, integration, E2E, security and evidence gates.

These states MUST NOT be conflated.

## 10. Current status

The graph schema and registry skeleton are now persisted. The registry is intentionally `NOT_GREEN` because the full v2.0 blueprint has not yet been mechanically projected into the registry. This prevents a false-green result.

## 11. Next gate

Build the L1-L4 reconciliation from the active v2.0 blueprint into the registry. Do not use historical `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` as a competing source. After the registry is populated, run deterministic duplicate/orphan/owner/coverage validation before resuming API and database field reconciliation.
