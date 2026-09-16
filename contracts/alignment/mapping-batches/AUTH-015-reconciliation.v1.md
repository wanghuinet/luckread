# AUTH-015 Real-Evidence Reconciliation v1

- Feature: `AUTH-015` — account deletion and restoration policy
- Status: `BLOCKED_NOT_GREEN`
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Mapping source: `contracts/alignment/cross-system-mapping.v1.json`
- Capability source: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`

## Current evidence

The canonical mapping records `AUTH-015` as `PARTIAL` with no API operation, entity, Payload collection, or code-evidence references. Its explicit blocker is `deletion/restoration contract mapping incomplete`.

The Blueprint establishes the feature requirement, but does not establish an executable deletion/restoration lifecycle.

## Blocking gaps

1. Canonical deletion-request and restoration API/DTO mappings are incomplete.
2. Eligibility, grace-period, irreversible-deletion, and restoration lifecycle semantics are not fully evidence-bound.
3. Entity/field/persistence mapping is missing.
4. Authorization, account-state, and security enforcement mapping is incomplete.
5. Data portability/deletion side effects and downstream lifecycle evidence are not fully reconciled.
6. Integration/security tests and Evidence Registry provenance are not closed.

## Admission decision

`AUTH-015` remains `BLOCKED_NOT_GREEN` and is not admitted to runtime implementation.

## Next closure action

Close the authoritative deletion/restoration contract, then bind API/DTO/entity/field/security/lifecycle/test/evidence identifiers to real repository artifacts and rerun the fail-closed Mapping 0 validator.
