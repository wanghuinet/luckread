# Change Control: AUTH-004 Wire Schema Authority Reconciliation — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-WIRE-SCHEMA-AUTHORITY-RECONCILIATION-2026-09-27`
- Status: `APPROVED_RECONCILIATION / WIRE_AUTHORITY_FROZEN`
- Feature: `AUTH-004`
- Parent authority: `docs/decisions/2026-09-26-password-recovery.md`
- Current main at reconciliation: `dda1233445fa2e7ca38e474b0d346c8e0a815a57`
- Backup: `backup/pre-auth004-contract-reconcile-20260927`

## Decision authority

The 2026-09-26 password-recovery decision is the authoritative feature-specific wire decision. The earlier decision-material artifact `CC-MAPPING-0-AUTH-004-WIRE-SCHEMA-DECISION-REQUIRED-2026-09-26.md` is reconciled as superseded decision status, not deleted.

The frozen public wire decisions are:

- `authPasswordChange`: `POST /auth/password/change`; request fields `currentPassword`, `newPassword`; success `204` with no body; Idempotency-Key required.
- `authPasswordResetRequest`: `POST /auth/password/reset/request`; request field `identifier`; success `202` with no body; uniform enumeration-resistant semantics; recovery delivery is asynchronous.
- `authPasswordResetConfirm`: `POST /auth/password/reset/confirm`; request fields `recoveryToken`, `newPassword`; success `204` with no body; replay is controlled by the single-use recovery boundary.

Password policy is 15..128 Unicode code points, Unicode and spaces are allowed, no composition-class requirement, and compromised-password screening is required.

Common public boundary remains `NO_STORE`; secret persistence/material remains non-public. Recovery delivery remains asynchronous.

## Scope boundary

This reconciliation authorizes:

- the existing canonical AUTH-004 API contract to retain the frozen wire schema;
- the existing Auth Operation Policy to retain the corresponding operation-policy values;
- a subsequent, separately controlled OpenAPI/DTO promotion step.

This reconciliation does not authorize:

- runtime implementation;
- W02 password-recovery endpoints;
- a custom recovery persistence subsystem;
- OpenAPI promotion in this same change;
- DTO Registry promotion in this same change;
- Evidence GREEN;
- Mapping 0 GREEN.

## Result

`AUTH-004` wire-schema authority is now frozen by an explicit authoritative decision chain. The next closure unit is OpenAPI/DTO promotion under a separate controlled change.