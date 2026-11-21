# B18 — Mapping 0 Final Consolidation Audit v1.0

Status: `BLOCKED_UNTIL_CANONICAL_GREEN`

## 1. Purpose

B18 is the final consolidation gate for Mapping 0. It does not promote any mapping by prose, historical status, blueprint closure, or inferred implementation. Promotion to `GREEN` is permitted only after the canonical registry and independent validators establish the complete evidence chain.

## 2. Canonical inputs

The audit consumes only repository-authoritative inputs:

- `contracts/alignment/feature-inventory.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`
- `contracts/alignment/api-inventory.v1.json`
- `contracts/alignment/payload-inventory.v1.json`
- `contracts/alignment/code-evidence-inventory.v1.json`
- `contracts/alignment/database-entity-persistence-inventory.v1.json`
- entity catalog and entity-field contracts
- canonical API/OpenAPI contracts
- security/authorization contracts
- lifecycle/state-machine contracts
- test and evidence registries
- CI/validator results

Batch files are source evidence only. They must not become competing sources of truth.

## 3. Required traceability chain

Every canonical Feature ID must resolve through:

`Feature → Capability → API → DTO → Entity → Field → Persistence → Payload → Code → Security → Lifecycle → Test → Evidence`

Any missing or ambiguous edge blocks promotion.

## 4. Blocking statuses

The following statuses are always blocking:

- `UNRESOLVED`
- `MISSING`
- `CONFLICT`
- `DUPLICATE`
- `DRIFT`
- `EXTRA`
- `BLOCKED`

An explicit non-empty `blockers` array is also blocking.

## 5. Consolidator verification

`scripts/consolidate-mapping-batches.mjs` is authoritative for deterministic batch consolidation. It verifies that every canonical Feature ID is represented exactly once, rejects missing/duplicate/unknown IDs, preserves unresolved mappings, and derives `GREEN` only when no record has a blocking status or blocker. It explicitly refuses to invent API/DTO/entity/field/Persistence/Payload/security/lifecycle/code/test evidence.

Therefore the consolidator's current `NOT_GREEN` result is a valid blocking result, not a defect to be bypassed.

## 6. Independent validator requirements

Mapping 0 may not become `GREEN` merely because consolidation succeeds. An independent validator must additionally verify:

1. every API reference resolves to an authoritative API contract;
2. every DTO reference resolves to an authoritative DTO schema;
3. every entity and field reference resolves to the canonical entity/field registries;
4. persistence mappings have concrete migration/table/column/type/nullability/constraint/index evidence;
5. Payload collection/config evidence matches the canonical entity authority;
6. security policy and enforcement evidence exist for privileged and scoped operations;
7. lifecycle/state-machine references resolve and enforcement is evidenced;
8. every implementation reference resolves to repository code evidence;
9. every test reference resolves to an executable test or verified CI result;
10. every evidence record identifies a reproducible repository source and commit SHA;
11. no implementation exists outside the canonical contract graph without an explicit admitted exception;
12. no canonical contract exists without an implementation admission decision where implementation is required.

## 7. Evidence Registry gate

An empty, partial, stale, or unbound Evidence Registry cannot pass. Evidence must be attached to the exact mapping edge it proves. Documentation statements without repository evidence do not satisfy the gate.

## 8. Current audit finding

Current repository evidence establishes that the canonical mapping is still not green. The existing consolidation validator intentionally preserves unresolved mappings, and the repository still contains mapping batches whose records are explicitly evidence-only inventories. Therefore B18 remains blocked.

No code-development admission is granted by this document.

## 9. Development admission rule

Base/Worker implementation may begin only after all of the following are simultaneously true:

- canonical `cross-system-mapping.v1.json` reports `GREEN`;
- record count equals canonical Feature Inventory count;
- blocking status count is zero;
- explicit blocker count is zero;
- independent Mapping 0 validator passes;
- Entity/Field/Persistence reconciliation passes;
- API/DTO reconciliation passes;
- Security/Lifecycle reconciliation passes;
- Test/Evidence Registry reconciliation passes;
- Contract CI and API Contract CI pass;
- the final audit is reproducible from a clean checkout.

## 10. Fail-closed principle

If any authoritative input is missing, stale, contradictory, unverifiable, or generated from inferred data, Mapping 0 remains `NOT_GREEN`.

`GREEN` is an evidence result, not a target string to be edited into a registry.

## 11. Next action

Run the complete canonical consolidation and independent validator chain, enumerate every remaining blocking Feature ID, then close the blockers in evidence-backed batches. Do not start base/Worker implementation until the final audit genuinely passes.
