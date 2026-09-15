# B19 — AUTH-001 Real Evidence Reconciliation v1.0

## Status

`BLOCKED_UNTIL_IMPLEMENTATION_AND_PERSISTENCE_EVIDENCE`

## Scope

Canonical feature: `AUTH-001`

Canonical API operation already established by repository contracts: `authRegister`.

## Evidence discovered

1. `contracts/openapi/v1/openapi.yaml` defines `authRegister` as the registration operation at `POST /auth/register`.
2. `contracts/openapi/v1/operation-policy.json` contains `authRegister` as a public operation.
3. `contracts/api/auth-operation-policy.v1.json` contains the canonical `authRegister` operation policy.
4. `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json` references `authRegister`, but its DTO/data/page references are not fully bound.
5. `contracts/entity/entity-catalog.v1.json` establishes `ENT-USER` as the currently verified User entity and points to `src/collections/Users.ts`.
6. `contracts/entity/entity-field-contract.v1.json` establishes the currently verified `ENT-USER` field contract for username and the other current User fields.
7. `contracts/payload/payload-native-inventory.v1.json` records the Payload `users` collection and `src/collections/Users.ts` as its source reference.
8. Repository search did not establish a concrete implementation handler for `authRegister`; therefore no code implementation claim is made here.
9. Repository evidence also does not yet establish the concrete D1 table/column/migration/execution chain required for `ENT-USER` persistence.

## Mapping decision

The following links are evidence-supported and may be retained:

- `AUTH-001 -> authRegister`
- `AUTH-001 -> ENT-USER` as the currently verified User entity candidate for the account created by registration, subject to the canonical entity/API reconciliation rules.
- `AUTH-001 -> Payload users` as existing Payload collection evidence.

The following links MUST remain unresolved:

- Request/response DTO IDs
- concrete API handler/code evidence
- complete field-level request-to-entity mapping
- concrete D1 table/column mapping
- migration ID/path and execution evidence
- registration security enforcement evidence
- account lifecycle transition evidence
- integration/E2E test evidence
- Evidence Registry record bound to an executed verification result

## Fail-closed rule

This batch MUST NOT promote `AUTH-001` to GREEN merely because an OpenAPI operation, Payload collection, or User entity exists. The canonical mapping requires the complete evidence chain:

`Feature -> API -> DTO -> Entity -> Field -> Persistence -> Payload -> Code -> Security -> Lifecycle -> Test -> Evidence`

Until every required link has repository evidence, `AUTH-001` remains blocking and Mapping 0 remains `NOT_GREEN`.

## Next closure action

Establish the real registration implementation boundary first. Then bind its DTOs and field mapping, followed by migration-backed persistence evidence and executable security/lifecycle/integration tests. Only after those artifacts exist should the canonical `cross-system-mapping.v1.json` be regenerated and evaluated by the fail-closed consolidator.
