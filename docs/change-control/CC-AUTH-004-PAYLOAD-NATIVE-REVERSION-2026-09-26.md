# CC-AUTH-004-PAYLOAD-NATIVE-REVERSION — 2026-09-26

## Decision

AUTH-004 returns to Payload-native authentication and password-recovery capability.

The implementation baseline is the existing W01 Payload `Users` collection with `auth` enabled. No parallel W02 password-recovery subsystem is authorized.

## Changes applied on main

- W01 `Users.ts` now uses Payload's native `auth` configuration.
- Native `forgotPassword` keeps its built-in recovery flow.
- Native `forgotPassword.minRequestInterval` is configured to 15 seconds.
- Payload auth responses are configured with `removeTokenFromResponses: true` to avoid returning auth tokens from authentication responses.
- No Payload core fork.
- No W02 recovery table or custom recovery migration.
- PR #21 and PR #22 were closed without merge.

## Contract rule

The existing AUTH-004 contract remains NOT_GREEN and must be reconciled against the Blueprint and actual Payload behavior before runtime admission. Where the contract is stricter than the product Blueprint but the stricter rule is not product-required, simplify it through Change Control rather than implementing a parallel subsystem.

## Evidence rule

This change does not establish AUTH-004 runtime, persistence, security-E2E, or Mapping-0 GREEN evidence. Existing verified evidence is inherited; no redundant deployment is implied by this refactor.

## Backup

Pre-change backup branch:

`backup/pre-payload-native-cleanup-20260926`


## Contract reconciliation completed

The canonical AUTH-004 implementation boundary is now explicitly Payload-native:

- `authPasswordResetRequest` maps to Payload `forgotPassword`.
- `authPasswordResetConfirm` maps to Payload `resetPassword`.
- `authPasswordChange` maps to authenticated Payload password update semantics.
- `resetPasswordToken` and `resetPasswordExpiration` are Payload-managed native recovery fields.
- No custom AUTH-004 recovery table or migration is required.
- The previous custom `tokenHash/recoveryId/consumedAt/invalidatedAt` persistence design is retained only as historical proposed design inside the AUTH-004 field contract; it is not an implementation admission.
- AUTH-004 remains evidence-gated and NOT_GREEN.

The migration manifest contained a pre-existing JSON structural error in the AUTH-002..006 manifest. While making the AUTH-004 native reconciliation, that syntax error was corrected without changing the other migration definitions.

## Current implementation rule

`Payload native capability > thin adapter if necessary > custom subsystem only by explicit later Change Control.`
