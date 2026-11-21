# AUTH-009 Real-Evidence Reconciliation v1

- Feature: `AUTH-009` — linked identities
- Status: `BLOCKED_NOT_GREEN`
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Mapping source: `contracts/alignment/cross-system-mapping.v1.json`

## Current evidence

The canonical mapping records `AUTH-009` as `PARTIAL` with no canonical API or entity mapping and no Payload/code-evidence references. The explicit blocker is `canonical linked-identity entity/API mapping missing`.

## Blocking gaps

1. Canonical linked-identity entity and field contract is not closed.
2. Link/unlink/list operations and DTO mappings are not evidence-bound.
3. Provider identity ownership, uniqueness, and account-linking lifecycle are not fully reconciled.
4. Authorization, security, persistence, tests, and Evidence Registry provenance remain incomplete.

## Admission decision

`AUTH-009` remains `BLOCKED_NOT_GREEN` and is not admitted to runtime implementation.

## Next closure action

Close the canonical linked-identity API/entity contract, bind it to real repository evidence, then rerun the fail-closed Mapping 0 validator.
