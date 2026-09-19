# Mapping 0 Closure Ledger & Continuation Cursor

> GitHub `main` is the sole authoritative work source for this ledger.
> This ledger is governance state, not Evidence by itself.

## Scope
- Scope: Mapping 0 closure, verification, evidence continuity, and change-control reconciliation only.
- Blueprint = WHAT.
- Contract = WHAT + RULE.
- Code = HOW.
- Evidence = proof of actual completion.
- No feature/runtime/business implementation is admitted merely because a mapping row exists.
- No valid Contract/Blueprint is deleted or rewritten during Mapping 0 closure.
- No authority conflict is resolved by inference.

## De-duplication / inheritance
A repeated task with the same scope, same authoritative inputs, and still-valid evidence is marked `PASS_INHERITED` ("通过（继承）") and is not re-executed or counted as new completion.
Evidence becomes invalid for inheritance when relevant code, Contract, Blueprint, authority decision, dependency, verification scope, or tested head changes. An evidence-only commit that changes none of those inputs does not invalidate the underlying result; the inheritance record must identify the unchanged tested input set and the evidence-only delta.
Duplicate observations link back to the single primary task record.

Allowed task states:
`PASS_INHERITED`, `PASS_VERIFIED`, `TODO_VERIFY`, `TODO_FIX`, `WAIT_AUTHORITY_DECISION`, `BLOCKED_EXTERNAL`, `SUPERSEDED_DUPLICATE`.

## Batch rule
1. Start from the latest `main` SHA.
2. Read this ledger before selecting work.
3. Select exactly one `NEXT_ITEM_ID` (plus only directly dependent work).
4. Do not repeat a task whose valid result is already inherited.
5. Update the cursor only when state actually changes.
6. Every claim must identify its source/head/scope; stale or differently-tested artifacts are historical, not current evidence.

## Recovery audit — 2026-09-20
Primary task: `AUDIT-REPEAT-AND-DRIFT-01`
Status: `PASS_VERIFIED`

Observed:
- Before recovery, `main` = `0f5c0946991cd5bf5b762567ac2d2e72022594a9`.
- `a0539040353c963ef3f97524d65a5a9393980ac9` contained a full repository tree (970 entries).
- `9df2cb58ca1a293c77acdd1491e5342835d3d37a` reduced the tree to 3 entries.
- `e7ff82c28f990a05c698d261778d70c99c00549c` remained at 3 entries.
- `0f5c0946991cd5bf5b762567ac2d2e72022594a9` had 4 entries.
- This was a destructive repository-tree drift, not a valid Mapping 0 closure operation.
- A recovery branch `recovery/mapping-0-corrupt-main-2026-09-20` was created at the corrupted head before recovery.
- `main` was force-restored to `a0539040353c963ef3f97524d65a5a9393980ac9`, restoring the 970-entry tree.
- No Contract/Blueprint/Feature/Entity/Field/operationId/runtime status was promoted during recovery.

Important evidence traceability finding:
- The restored queue is version 1.7 with 8 OPEN authority controls and 7 closed governance controls.
- Its tested head is `babb05c53731c53fb5730897b9dc1933ace2c463`, not current `main`.
- The restored historical CI observation tested `8a36b82005d308de65de302e2c6a29b30b7bda21`, not current `main`.
- Those artifacts remain historical and are not used as current-head proof.

## Current known Mapping 0 authority queue

The original 8 authority controls have now been decided. Current queue state is persisted in:
`artifacts/mapping-0/current-change-control-decision-queue-2026-09-20-v3.json`

Reconciled and verified at current scope:
- AUTH-006 status classification
- getEntitlements/listEntitlements operation treatment
- DTO representation decision
- AUTH-006 DTO aliases
- D01 Core logical domain naming
- W01 ENT-USER active field source/implementation
- W01 Media support-collection exemption

One original control remains technically pending:
- `CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19` — canonical operation set is selected, but canonical API/OpenAPI admission remains blocked by existing DTO/schema preconditions.

No operationId, Entity, Payload, Blueprint/Contract or D1 rule is changed by inference.

## Current historical Mapping 0 observation
The latest persisted Mapping 0 observation on restored `main` reports:
- Canonical Mapping: NOT_GREEN.
- 449 records: 433 UNRESOLVED, 14 PARTIAL, 2 MISSING.
- Structural cardinality: 449/449.
- Complete technical closure: 0/449.
- Feature Inventory: 449 DISCOVERED.
- Code evidence promoted to IMPLEMENTED: 0.
- Evidence registry: 11 records, stale relative to 2026-09-19.

These figures are explicitly historical until a new mapping-status snapshot is generated at a source-input-changing head. They are not re-counted as new work.

## Continuation cursor

Current structural handoff baseline: `9cdc9d4fb81d929dbd1911ac00be0c3c3769184d`.
Primary task:
- `M0-STRUCTURAL-HANDOFF-FINAL-ACCEPTANCE-01` = `PASS_VERIFIED`

Evidence:
- `artifacts/mapping-0/current-head-structural-handoff-2026-09-20-6e4612c.json`
- Mapping 0 Structural Gate run `35458363120` = success at tested source head `6e4612cb...`.
- Feature Inventory Gate run `35458363107` = success.
- Contract core gates through Capability Graph = success.
- Five-Way and Strict R4/Evidence/R5 = downstream failures; they do not invalidate the structural handoff under `CC-MAPPING-0-STAGE-SEPARATION-2026-09-18`.

The intervening commits after the tested source head are reconciliation/evidence/governance changes; unchanged structural results are inherited rather than rerun.

NEXT_ITEM_ID: `W01-MIGRATION-GENERATION-001`
NEXT_ITEM_STATE: `TODO_VERIFY`
Objective: generate and statically audit the exact Payload migration required by the approved ENT-USER schema in active W01. Do not execute remote D1 migrations. Do not hand-author DDL.

Generation evidence:
- First attempt run `35459726942` failed because the W01 production CLI path triggered Wrangler remote proxy without `CLOUDFLARE_API_TOKEN`.
- The workflow was corrected in `8f5df6646dda757e5dd9f7b5847a2efbc1cb93e4` to use the local proxy for migration generation.
- Second attempt run `35459760432` is the current generation evidence source.
- A successful generation must pass `scripts/auth-002-migration-static-audit.mjs` and produce an artifact before any migration source is committed.


## Completion gate
Mapping 0 is not GREEN until the authoritative mapping state, open authority controls, required reconciliations, and current-head CI/evidence gates all satisfy their contracts. A historical "100%" report does not override current GitHub evidence.
