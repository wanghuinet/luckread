# AUTH-004 reconciliation handoff

Current decision record: docs/decisions/2026-09-26-password-recovery.md
Decision state: AUTHORITY_DECIDED
Reconciliation state: CONTRACT_WRITE_RECONCILED / OPENAPI_ADMISSION_PENDING

The project authority decision is complete for the three canonical password operations. The accepted wireContract and operation-policy values are now encoded in the existing canonical API contract and Auth Operation Policy at main commit `3ab18252544ffb9a15da3380b5878d5c6b6fc63a`. No runtime implementation, OpenAPI promotion, DTO promotion, Mapping 0 promotion, or Evidence GREEN is implied.

The controlled contract write has completed. No runtime implementation, OpenAPI promotion, DTO registry promotion, Mapping 0 promotion, or Evidence GREEN is implied by this reconciliation.

Backup created before the authority decision: backup/main-before-auth004-authority-decision-20260926
Main decision commit: f5be3b5c65f340a69e7faa8db65e07722aa4d779
