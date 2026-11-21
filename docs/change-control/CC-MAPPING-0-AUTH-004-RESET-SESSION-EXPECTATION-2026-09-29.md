# CC-MAPPING-0-AUTH-004-RESET-SESSION-EXPECTATION — 2026-09-29

## Classification

- Change type: evidence-harness correction
- Runtime/API Contract: unchanged
- Implementation mode: PAYLOAD_NATIVE
- Status: NOT_GREEN; execution remains deployment/evidence gated
- Triggering evidence: AUTH-004 Remote HTTP E2E run `36454779860`

## Root cause

The corrected AUTH-004 E2E harness successfully passed the password-change session semantics but then failed on the assertion:

`password reset left native sessions`.

Payload 3.90.2's native `resetPassword` operation first clears existing sessions and then creates a new native session as part of the reset operation.

The LuckRead anonymous reset-confirm adapter intentionally discards Payload's returned JWT to preserve the contract's `204 No Content` response.

## Correction

`scripts/auth-004-remote-e2e.mjs` now asserts that after successful password reset:

1. the pre-reset session is rejected;
2. exactly one native session remains, created by Payload's reset operation;
3. the recovery token remains single-use and expired-token rejection is still tested.

No runtime auth path, Worker ownership, D1 authority, API shape, or recovery contract changed.

## Evidence gate

This correction does not promote AUTH-004 to GREEN. A fresh controlled deployment of the current main source is required before another remote E2E execution.

## Source references

- `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- `docs/decisions/2026-09-26-password-recovery.md`
- `docs/change-control/CC-AUTH-004-PAYLOAD-NATIVE-REVERSION-2026-09-26.md`
- Payload 3.90.2 native `resetPassword` implementation
