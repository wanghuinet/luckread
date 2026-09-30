# AUTH-013 Real-Evidence Reconciliation v1

- Feature: `AUTH-013` — account freeze/suspension/ban
- Status: `BLOCKED_NOT_GREEN`
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Mapping source: `contracts/alignment/cross-system-mapping.v1.json`
- Capability source: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`

## Current evidence

The canonical mapping records `AUTH-013` as `PARTIAL`, binds `transitionAccountState`, binds `ENT-USER`, and now records the canonical account-state Field IDs. Payload collection, DTO, persistence, code-evidence and runtime references remain unresolved.

Blueprint/capability inventory establishes the requirement, but does not establish executable enforcement.

## Required closure chain

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

No inferred API, DTO, entity, field, Payload table, Worker, or test identifier may be promoted to evidence.

## Blocking gaps

1. Canonical account-state model and transitions are not fully reconciled.
2. The canonical enforcement API binding is `transitionAccountState`; DTO mapping is now contract-admitted, while runtime enforcement evidence remains missing.
3. Entity field IDs and the D1-01 `users` persistence target are contract-admitted; physical post-migration evidence remains pending.
4. Security enforcement and deny-by-default behavior are not evidence-bound.
5. Lifecycle and restoration semantics are not fully reconciled.
6. Implementation and integration/security test evidence are not mapped.
7. Evidence Registry provenance is not closed.

## Admission decision

`AUTH-013` remains `BLOCKED_NOT_GREEN` and is not admitted to implementation.

## Next closure action

With authority and canonical Field IDs admitted, establish the authoritative D1-01 persistence mapping from actual schema/migration evidence, then bind DTO/security/lifecycle/test/evidence identifiers and rerun the fail-closed Mapping 0 validator.


## 2026-09-23 initialization/version gate

- The logical state-machine initial state remains `UNREGISTERED`; the first persisted User lifecycle state is now explicitly admitted as `PENDING_VERIFICATION` with `account_state_version = 1`.
- Every successful state-machine transition must increment the version exactly once; unsuccessful or stale transitions must not mutate it.
- Current D1-01 row applicability is `0/0 PASS_VERIFIED`; therefore the migration is admissible only for the captured zero-row target.
- A guarded W02 migration source is now admitted at `workers/W02-content/migrations/0002_auth_013_account_state.sql` with a fail-closed zero-row guard.
- Remote execution remains **NOT_EXECUTED** until the controlled migration workflow is explicitly dispatched with `confirm=APPLY`.

### Current cursor
**AUTH-013 → controlled zero-row D1-01 migration execution → exact post-schema evidence → W02 transition runtime implementation → security/concurrency/audit/event tests → Evidence Registry promotion.**
