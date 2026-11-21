# Change Control — AUTH-011 Current-Head Refresh Runtime Reconciliation
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-011-CURRENT-HEAD-REFRESH-RUNTIME-RECONCILIATION-2026-09-29`
- Scope: current-head reconciliation plus focused refresh runtime test coverage.
- Status: `IMPLEMENTATION_PRESENT / TESTS_EXPANDED / REMOTE_EVIDENCE_PENDING`
- Source baseline: `a1ff69e01c8e0294480f24f9c50721051a3f9547`
- Backup: `backup/pre-auth011-refresh-runtime-tests-20260929`

## Current-head findings

The current `main` already contains:

- canonical `POST /auth/refresh` with operationId `authRefresh`;
- request fields `refreshToken` and `deviceId`;
- response fields `accessToken`, `refreshToken`, `expiresIn`, `layer`;
- the existing W01 `/auth/refresh` handler;
- the existing W01 → W02 session client refresh call;
- the existing W02 `refreshSessionFromAuthoritativeD1` rotation implementation;
- canonical `user.session.refresh` permission.

The older AUTH-011 gate therefore remains useful as a fail-closed historical gate, but its statements that the wire/runtime surface is wholly absent are not current-head facts.

## Focused tests added

`workers/W02-content/src/session/session-runtime.test.ts` now covers:

1. successful predecessor refresh-token rotation;
2. predecessor replay rejection;
3. wrong-device rejection before rotation;
4. authoritative authorization denial;
5. concurrent predecessor rotation with at most one successful successor.

These tests prove source-level behavior only.

## Runtime/evidence boundary

No claim is made for:

- deployed W01/W02 runtime;
- remote D1 schema equivalence;
- public HTTP E2E;
- Evidence Registry admission;
- AUTH-011 GREEN;
- Mapping 0 GREEN.

AUTH-010 remains the canonical Session management model consumed by AUTH-011; no second Session entity, native timestamp authority, or storage model is introduced.
