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
2. The canonical enforcement API binding is `transitionAccountState`; DTO mapping and runtime enforcement evidence are still missing.
3. Entity field IDs are now admitted; physical persistence mapping remains missing.
4. Security enforcement and deny-by-default behavior are not evidence-bound.
5. Lifecycle and restoration semantics are not fully reconciled.
6. Implementation and integration/security test evidence are not mapped.
7. Evidence Registry provenance is not closed.

## Admission decision

`AUTH-013` remains `BLOCKED_NOT_GREEN` and is not admitted to implementation.

## Next closure action

With authority and canonical Field IDs admitted, establish the authoritative D1-01 persistence mapping from actual schema/migration evidence, then bind DTO/security/lifecycle/test/evidence identifiers and rerun the fail-closed Mapping 0 validator.
