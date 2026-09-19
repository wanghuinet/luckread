# CC-MAPPING-0-OPENAPI-DUPLICATE-GET-ENTITLEMENTS-2026-09-19

## Status

OPEN — DECISION REQUIRED / NO AUTO-REPAIR

## Purpose

Record an exact canonical API operationId collision discovered by the 2026-09-19 global API Inventory ↔ OpenAPI audit.

## Verified facts

1. Canonical API Inventory contains two `getEntitlements` records:
   - `GET /v1/entitlements`
   - `GET /v1/entitlements/{subjectId}`
2. Both records currently use the same `operationId: getEntitlements`.
3. Canonical OpenAPI contains two `getEntitlements` declarations:
   - the parameterized `/entitlements/{subjectId}` declaration with effective-entitlement response semantics;
   - `/entitlements` declaration marked `x-luckread-contract-status: DISCOVERY_DRAFT`.
4. The global set audit found:
   - API Inventory operations: 151 rows / 150 unique IDs;
   - OpenAPI operations: 151 rows / 150 unique IDs;
   - set difference: 0 missing, 0 extra;
   - duplicate ID in both sources: `getEntitlements`.
5. The current API policy states that every OpenAPI operationId MUST appear exactly once in operations.

## Conflict

The sources have matching operationId sets but violate operationId uniqueness for `getEntitlements`.

This must not be resolved by guessing whether:
- the collection endpoint should receive a distinct canonical operationId;
- the discovery draft should be removed/archived;
- the parameterized operation should be renamed;
- or one path is intended to be a duplicate artifact.

## Required authority decision

Choose the canonical treatment under Change Control, then reconcile:
- API Inventory;
- OpenAPI;
- DTO references;
- operation policy;
- affected Feature mappings;
- generated validation artifacts.

No automatic deletion, renaming, or status promotion is performed by this record.

## Gate impact

- Canonical API/OpenAPI set equality: preserved.
- OperationId uniqueness: NOT_GREEN.
- Mapping 0 structural gate: unchanged.
- Technical closure: unchanged.
- No business implementation authorized by this record.

## Evidence

- `artifacts/mapping-0/canonical-api-openapi-set-drift-audit-2026-09-19.json`
- `contracts/alignment/api-inventory.v1.json`
- `contracts/openapi/v1/openapi.yaml`

## Acceptance

Future conversations must classify this as an already-detected operationId collision rather than rediscovering it.
