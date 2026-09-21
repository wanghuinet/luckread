# Change Control — AUTH-002 E6 Wire/Input Gaps

- ID: CC-MAPPING-0-AUTH-002-E6-WIRE-INPUT-GAPS-2026-09-21
- Date: 2026-09-21
- Status: OPEN — REQUIRED CONTRACT INPUTS MISSING
- Feature: AUTH-002
- Gate: E6 Native Session Runtime Evidence
- Parent: CC-MAPPING-0-AUTH-002-E6-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-21

## Objective

Record only the missing authoritative inputs that prevent safe implementation of the already-contracted E6 runtime behavior. This Change Control does not add API fields, choose a device identification mechanism, or implement runtime code.

## Gap E6-WIRE-001 — authRefresh wire authority missing

Observed repository facts:
- `contracts/api/auth-operation-policy.v1.json` defines `authRefresh` as POST `/auth/refresh` with refresh-token rotation, reuse detection, revoked-session denial and old-refresh-token invalidation.
- `contracts/api/auth-operation-policy.v1.json` marks the operation `contractStatus: CONTRACTED_PARTIAL` and `evidence.openapi: MISSING`.
- `contracts/openapi/v1/openapi.yaml` defines `authLogin` and `authLogout`, but no canonical `/auth/refresh` route is currently present.

Required resolution:
- Establish the canonical `authRefresh` wire contract (request, response, errors, authentication mode and permission semantics) through the normal Contract-First Change Control path.
- Do not implement or expose a refresh endpoint by inferring its schema from the operation policy or Payload's native refresh endpoint.

## Gap E6-WIRE-002 — device binding input authority missing

Observed repository facts:
- `ENT-SESSION-F-DEVICE-ID` is a required immutable privacy-sensitive Session field.
- The minimum integration contract requires an authoritative device binding at login and validation.
- Current `/auth/login` OpenAPI request contains only `identity` and `credential`; no canonical device input/header contract is defined in the current OpenAPI source.
- Repository search did not establish a canonical `deviceId` or `device-id` transport field for AUTH-002.

Required resolution:
- Establish the authoritative source and transport semantics for the privacy-safe device binding.
- The resolution must specify whether the value is client supplied, server issued, previously bound, or derived from another already-contracted authority.
- Do not derive a fingerprint from IP, User-Agent or other uncontracted attributes.
- Do not create `ENT-DEVICE-RECORD` or another device persistence authority solely to fill this gap.

## Cross-domain dependency confirmation

The repository already identifies `AUTH-011/authRefresh` as a separate Contract-First dependency:
- `contracts/alignment/mapping-batches/AUTH-011-runtime-gate.v1.md` requires the canonical OpenAPI path, Request DTO, Response DTO, credential/session field authority and executable rotation/reuse evidence before runtime promotion.
- `contracts/alignment/mapping-batches/AUTH-010-canonical-openapi-patch.v1.md` does not authorize an `authRefresh` route handler; it only defines the separate session-list/revoke OpenAPI patch.
- Therefore E6 cannot invent a refresh route or DTO to satisfy its runtime test. The missing `authRefresh` wire authority must be resolved through the existing AUTH-011/AUTH-010 contract chain where applicable.

## Impact

Until E6-WIRE-001 and E6-WIRE-002 are resolved:
- `GAP-E6-RUNTIME-001` remains open.
- E6 runtime implementation admission remains blocked.
- No authentication runtime code should be added.
- No new public endpoint, DTO, header, field, Worker, D1 domain or persistence authority should be introduced.
- No AUTH-002 or Mapping-0 status promotion is allowed.

## Evidence references

- `contracts/api/auth-operation-policy.v1.json`
- `contracts/openapi/v1/openapi.yaml`
- `contracts/entity/AUTH-002-session-field-contract.v1.json`
- `contracts/persistence/AUTH-002-minimum-session-integration-contract.v1.json`
- `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`

## Exit condition

Close this Change Control only after canonical wire/input authority is established and reconciled. The resulting decision must then feed the existing E6 Implementation Admission Change Control. No implementation is admitted by this record.


## Current evidence binding — 2026-09-21

The two gaps are now independently tied to current repository snapshots:
- E6-WIRE-001: `artifacts/mapping-0/auth-011-wire-authority-drift-2026-09-21.json` = `DRIFT_CONFIRMED`. Current API Inventory requires `POST /v1/auth/refresh`; canonical OpenAPI does not currently define it.
- E6-WIRE-002: `artifacts/mapping-0/auth-002-device-binding-authority-audit-2026-09-21.json` = `INPUT_AUTHORITY_MISSING_CONFIRMED`. The canonical Session/entity and persistence contracts require `deviceId`, but current AUTH API/DTO/Policy sources define no transport/source authority.

These artifacts are authority/evidence records only. They do not promote either operation or field and do not authorize implementation.


## Current evidence correction — 2026-09-21

A fresh current-head inspection corrected the earlier description of E6-WIRE-001:
- `contracts/openapi/v1/openapi.yaml` **does contain** `/auth/refresh`.
- It also contains `operationId: authRefresh`.
- The operation is explicitly marked `x-luckread-contract-status: DISCOVERY_DRAFT`.
- Its summary remains discovery-only (`Discovery draft for POST undefined`), with no concrete request body and no concrete success response schema.
- Therefore the route shell is present, but the canonical Wire Authority is **not admitted** and the exact Request/Response/Error DTO contract remains unresolved.
- The corrected audit artifact is `artifacts/mapping-0/auth-011-wire-authority-drift-2026-09-21.json` = `DRIFT_CONFIRMED`.
- The audit script was hardened in commit `f45fc4b096a1e2bede7b62cf5d987b66e18bbf4d` so a Discovery Draft is not mistaken for canonical admission.

This is a correction to evidence interpretation only. It does not promote the route, add DTOs, or authorize runtime implementation.