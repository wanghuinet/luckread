# AUTH-002 / AUTH-003 Batch Closure Gate v1.0

## Purpose

Batch AUTH-002 and AUTH-003 closure without manufacturing GREEN status. Contract definitions may be closed in batches, but implementation/evidence gates remain fail-closed.

## Authority

- Blueprint: `docs/00-LUCKREAD-BLUEPRINT-CLOSURE-v3.0.md`
- Feature inventory: `contracts/alignment/feature-inventory.v1.json`
- API auth policy: `contracts/api/auth-operation-policy.v1.json`
- B01 reconciliation: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Entity catalog: `contracts/entity/entity-catalog.v1.json`
- Entity field contract: `contracts/entity/entity-field-contract.v1.json`

## Gate policy

`DEFINED != MAPPED != IMPLEMENTED != VERIFIED != GREEN`.

A feature is GREEN only when every required downstream reference is authoritative, executable evidence exists, and the validator accepts the evidence package for the tested commit SHA.

## AUTH-002 — Login / Logout

Current repository state: `BLOCKED_NOT_GREEN`.

### Existing authoritative references

- API operations: `authLogin`, `authLogout`
- Account lifecycle state machine
- AUTH-002 Session field/persistence/integration contracts
- AUTH-002 schema evidence workflow and validator

### Remaining GREEN gates

1. Promote `ENT-SESSION` from `PROPOSED` only after explicit field and persistence evidence is captured.
2. Bind canonical Session DTO/entity/field mappings.
3. Capture controlled remote D1 schema and migration evidence.
4. Bind executable login/logout handlers to the canonical operations.
5. Produce account-state enforcement evidence.
6. Produce security E2E evidence for enumeration resistance, credential non-disclosure, self-scope revocation, and cache-bypass revocation.
7. Produce integration/negative-path test evidence.
8. Register non-empty Evidence Registry references.
9. Run the mapping validator and bind the result to the tested commit SHA.

## AUTH-003 — Username / Email / Phone Credentials

Current repository state: `BLOCKED_NOT_GREEN`.

### Existing authoritative references

- Feature inventory definition
- B01 reconciliation behavior: deterministic normalization/validation/association and protected account-existence non-disclosure
- Identity/session registry coverage
- Existing verified `ENT-USER` profile field contract

### Remaining GREEN gates

1. Establish canonical API operation IDs for credential lifecycle behavior without inventing semantics outside the Blueprint.
2. Establish canonical request/public DTO IDs.
3. Establish authoritative `ENT-IDENTITY` / `ENT-CREDENTIAL` entities or formally prove that an existing entity is sufficient.
4. Establish canonical username/email/phone field IDs and normalization rules.
5. Bind persistence fields, uniqueness constraints, and D1 domain/table mappings.
6. Bind permission/scope mappings for credential management.
7. Bind credential lifecycle state transitions and security events.
8. Implement and execute runtime behavior.
9. Produce uniqueness, normalization, protected-account-enumeration and credential non-disclosure tests.
10. Register Evidence IDs and run the final mapping validator against a commit SHA.

## Batch completion rule

This batch MUST remain `NOT_GREEN` while any listed gate is missing, inferred, or unexecuted. Updating a status field without the corresponding evidence is prohibited.

## Next execution batch

Resolve AUTH-002 real schema/runtime evidence first, then resolve AUTH-003 canonical identity/credential mapping. After both pass, rerun the B01 mapping/evidence validators before opening the next Auth slice.
