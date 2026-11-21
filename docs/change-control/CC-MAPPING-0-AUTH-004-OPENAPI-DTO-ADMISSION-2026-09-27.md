# Change Control: AUTH-004 OpenAPI / DTO Admission Reconciliation — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-OPENAPI-DTO-ADMISSION-2026-09-27`
- Status: `RECONCILED / NOT_GREEN`
- Feature: `AUTH-004`
- Parent wire authority: `CC-MAPPING-0-AUTH-004-WIRE-SCHEMA-AUTHORITY-RECONCILIATION-2026-09-27`
- Base main: `1508c13f46ee26b9b1644761a1f2279c5351717d`
- Backup: `backup/pre-auth004-openapi-dto-admission-20260927`

## Admission scope

The frozen AUTH-004 wire contract is now represented in the canonical OpenAPI document:

- `authPasswordChange` — `POST /auth/password/change` — 204, no body, bearer auth, required `Idempotency-Key`.
- `authPasswordResetRequest` — `POST /auth/password/reset/request` — 202, no body, anonymous, enumeration-resistant public semantics.
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm` — 204, no body, anonymous/token-bound, single-use recovery boundary.

The canonical error envelope is referenced through the existing `4XX` ClientError response component. No feature-local error shape is introduced.

## DTO reconciliation

The feature contract's five AUTH-004 DTO identifiers remain the authoritative vocabulary.

Because the approved wire decision explicitly makes all three operations no-body responses, the canonical DTO registry binds only request DTOs and records each operation as `NO_BODY_DTO`. The response DTO identifiers remain vocabulary-only contract identifiers; they are not invented into response schemas that do not exist on the wire.

This follows the established canonical `authLogout` representation and avoids fabricating a 204/202 response body.

## Explicit non-actions

- No AUTH-004 runtime code added.
- No W02 recovery endpoint added.
- No custom recovery table or migration added.
- No Evidence Registry PASS claim added.
- No Mapping-0 GREEN claim added.
- No Payload core modification added.

## Required verification

The next required step is existing API/Contract/OpenAPI CI against the resulting commit. A successful contract check validates schema/admission integrity only; it does not establish AUTH-004 runtime, persistence, security-E2E, or GREEN evidence.
