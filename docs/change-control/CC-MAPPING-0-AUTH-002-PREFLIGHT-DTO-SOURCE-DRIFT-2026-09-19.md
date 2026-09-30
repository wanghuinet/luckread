# CC-MAPPING-0-AUTH-002-PREFLIGHT-DTO-SOURCE-DRIFT-2026-09-19

## Status

CLOSED — TOOLING/VALIDATOR RECONCILIATION VERIFIED (2026-09-19)

## Finding

`scripts/auth-002-mapping0-preflight.mjs` was still using the archived DTO source `contracts/dto/auth-dto-records.v1.json` and expected the obsolete `record.dtoId` shape.

The current canonical DTO authority is `contracts/dto/auth-dto-contract.v1.json`, whose AUTH-002 records expose operation-level `requestDtoId`, `responseDtoId`, and explicit `NO_BODY_DTO` status for logout.

The validator is executed by `.github/workflows/auth-002-promotion-matrix.yml`, so the drift affected an active CI path.

## Resolution

The validator now:
1. reads `contracts/dto/auth-dto-contract.v1.json`;
2. verifies AUTH-002 `authLogin` exists and is `CONTRACT_BOUND`;
3. verifies AUTH-002 `authLogout` exists and is `NO_BODY_DTO` with no body DTO IDs;
4. verifies the AUTH-002 persistence binding remains exactly `DTO-AUTH-LOGIN-REQUEST` and `DTO-AUTH-LOGIN-RESPONSE`;
5. retains all fail-closed runtime/persistence/security/evidence gates.

The workflow trigger paths were also reconciled so the obsolete `auth-dto-records.v1.json` path is no longer referenced.

## Verification

Current `main` inspection confirms:
- validator no longer references `auth-dto-records.v1.json`;
- workflow no longer references `auth-dto-records.v1.json`;
- canonical DTO path is present;
- AUTH-002 login/logout status checks are present;
- no Worker/feature/business code was changed by this control.

## Boundary

This closes only the validator/tooling source drift.

AUTH-002 remains NOT_GREEN because runtime, persistence execution, security E2E, concurrency and fresh Evidence Registry requirements remain open.
