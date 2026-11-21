# CC-MAPPING-0-AUTH-003-WIRE-SCHEMA-ENCODING-RECONCILIATION-2026-09-27

## Scope

Reconcile the current repository state for the AUTH-003 public wire/API/DTO chain after the existing OpenAPI surface and DTO bindings are verified present.

## Verified inputs

- Wire authority: `artifacts/mapping-0/auth-003-wire-projection-authority-2026-09-26.json` = `PASS_VERIFIED`
- Canonical OpenAPI: `contracts/openapi/v1/openapi.yaml`
- Canonical DTO contract: `contracts/dto/auth-dto-contract.v1.json`
- DTO records: `contracts/dto/auth-dto-records.v1.json`
- API Contract CI: passed on the current wire/contract state
- AUTH-003 operations: `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove`

## Reconciliation result

The canonical OpenAPI already contains:

- `GET /auth/credentials`
- `POST /auth/credentials`
- `PUT /auth/credentials/{credentialId}`
- `DELETE /auth/credentials/{credentialId}`

with matching operationIds, request/response schemas, credentialId parameter, canonical error responses, and idempotency metadata required by the frozen AUTH-003 wire authority.

The canonical DTO contract already binds AUTH-003 list/add/replace/remove. The DTO records resolve to the current OpenAPI schema references; remove is an explicit 204 no-body operation.

Therefore this batch performs **reconciliation only**: it does not add or alter public routes and does not create new wire semantics.

## Downstream boundary

Still open:

- credential-list runtime implementation/evidence;
- credential-replace runtime implementation/evidence;
- credential-remove runtime implementation/evidence;
- ENT-IDENTITY / ENT-CREDENTIAL final catalog promotion;
- global Mapping 0 / Five-Way closure.

No migration rerun, D1 mutation, production deployment, or Mapping 0 GREEN promotion is performed by this control.