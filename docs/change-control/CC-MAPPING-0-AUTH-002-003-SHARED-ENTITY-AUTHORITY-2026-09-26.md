# Change Control — AUTH-002 / AUTH-003 Shared Entity Authority
## 2026-09-26

- Control ID: `CC-MAPPING-0-AUTH-002-003-SHARED-ENTITY-AUTHORITY-2026-09-26`
- Scope: Mapping 0 / R4 cross-feature dependency reconciliation only
- Status: `CLOSED — PASS_VERIFIED`
- Implementation authorization: `false`
- Runtime admission: `unchanged`
- Mapping promotion: `unchanged`

## Decision

1. **Canonical entity/field ownership**
   - `AUTH-003` is the governing feature for the canonical Identity/Credential entity contracts:
     - `ENT-IDENTITY`
     - `ENT-CREDENTIAL`
   - Their field authority remains:
     - `contracts/entity/AUTH-003-identity-field-contract.v1.json`
     - `contracts/entity/AUTH-003-credential-field-contract.v1.json`
   - Their persistence/runtime verification remains governed by AUTH-003's own closure and evidence gates.

2. **AUTH-002 dependency semantics**
   - AUTH-002 may reference `ENT-IDENTITY` and `ENT-CREDENTIAL` as **shared canonical dependencies** in its existing mapping contract.
   - These references do **not** make AUTH-002 the owner of those entities or fields.
   - The existing AUTH-002 entity reference set is therefore retained unchanged:
     - `ENT-IDENTITY`
     - `ENT-CREDENTIAL`
     - `ENT-SESSION`

3. **No promotion by dependency inheritance**
   - AUTH-002 must not infer runtime or persistence verification for `ENT-IDENTITY` or `ENT-CREDENTIAL` from AUTH-003 contracts alone.
   - AUTH-003 must not inherit implementation/persistence verification merely because AUTH-002 runtime evidence exists.
   - `entity-catalog.v1.json` remains fail-closed:
     - `ENT-IDENTITY = PROPOSED`
     - `ENT-CREDENTIAL = PROPOSED`
     - `ENT-SESSION = PROPOSED`

4. **R4 consequence**
   - The cross-feature ownership/dependency ambiguity is resolved for reconciliation purposes.
   - The R4 Feature→Entity→Persistence registry remains `BLOCKED` because entity verification/persistence evidence is still missing for `ENT-IDENTITY` and `ENT-CREDENTIAL`.
   - AUTH-002 must not be marked `VERIFIED` by this decision.

## Evidence basis

- `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`
- `contracts/entity/AUTH-002-006-canonical-field-authority.v1.json`
- `contracts/api/AUTH-003-credential-management-contract.v1.json`
- `contracts/entity/AUTH-003-identity-field-contract.v1.json`
- `contracts/entity/AUTH-003-credential-field-contract.v1.json`
- `contracts/entity/entity-catalog.v1.json`
- `artifacts/mapping-0/auth-002-r4-entity-persistence-reconciliation-2026-09-26.json`

## Non-changes

- No API operationId change.
- No DTO change.
- No Worker code change.
- No D1 schema or migration change.
- No entity creation or deletion.
- No entity catalog promotion.
- No Evidence Registry promotion.
- No rerun of AUTH-002 Runtime Evidence Run `36219132123`.

## Reconciliation result

`M0-AUTH-002-R4-CROSS-ENTITY-DEPENDENCY-RECONCILIATION-001 = PASS_VERIFIED`

This closes the dependency-classification blocker only. The next executable gate is entity-specific persistence/runtime evidence for `ENT-IDENTITY` / `ENT-CREDENTIAL`; until then AUTH-002 R4 remains blocked.
