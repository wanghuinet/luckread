# Change Control: AUTH-004 Native Local Lifecycle Evidence — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-NATIVE-LOCAL-LIFECYCLE-EVIDENCE-2026-09-27`
- Status: `EVIDENCE_HARNESS_ONLY / NOT_GREEN`
- Feature: `AUTH-004`
- Base commit: `8d95e3938c670e1d09c50f155859d357634612f7`
- Backup: `backup/pre-auth004-native-runtime-evidence-20260927-b`

## Scope

The new probe exercises Payload's existing Local API native authentication operations without adding a parallel recovery subsystem.

It covers:

- authenticated password update and other-session revocation;
- native `forgotPassword`;
- native `resetPassword`;
- single-use reset-token enforcement;
- expired reset-token rejection.

Tokens and passwords remain process-local to the test and are not written to evidence artifacts.

## Evidence boundary

This is Local API integration evidence only. It does not by itself prove remote W01 behavior or promote AUTH-004/M0 to GREEN.

Remote evidence remains separately gated by the controlled W01 deployment/runtime path.
