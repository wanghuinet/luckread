# CC-MAPPING-0-AUTH-004-E2E-SESSION-EXPECTATION — 2026-09-29

## Classification

- Change type: evidence-harness correction
- Runtime/API Contract: unchanged
- Implementation mode: PAYLOAD_NATIVE
- Status: NOT_GREEN; execution gate remains deployment/evidence gated

## Root cause

AUTH-004 Remote HTTP E2E run `36453411549` failed at the password-change session assertion:

`first session after change: expected 401, got 200`.

The deployed W01 source and Payload 3.90.2 migration preconditions both passed. The failure was caused by the evidence harness expecting all native sessions to be revoked.

## Canonical native behavior

Payload 3.90.2 retains the authenticated request's current native session during an authenticated password update and removes the other affected native sessions.

This matches the existing AUTH-004 contract wording that successful password change revokes affected sessions and the current implementation comment in `workers/W01-payload/src/app/auth/password/change/route.ts`.

## Correction

`scripts/auth-004-remote-e2e.mjs` was corrected to assert:

1. the session used to perform the password change remains valid;
2. the other pre-change session is rejected with HTTP 401;
3. exactly one native session row remains after the change.

No runtime authentication path, Worker ownership, D1 authority, API shape, or password-recovery contract was changed.

## Evidence gate

This correction does not promote AUTH-004 to GREEN. A fresh controlled W01/W02 binding deployment of the current main source, followed by the existing AUTH-004 remote E2E workflow, remains required.

## Source references

- `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- `docs/decisions/2026-09-26-password-recovery.md`
- `docs/change-control/CC-AUTH-004-PAYLOAD-NATIVE-REVERSION-2026-09-26.md`
- Payload 3.90.2 native update/session behavior referenced by the implementation baseline
