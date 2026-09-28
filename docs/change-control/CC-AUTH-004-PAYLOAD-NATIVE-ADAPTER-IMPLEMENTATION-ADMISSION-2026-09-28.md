# CC-AUTH-004-PAYLOAD-NATIVE-ADAPTER-IMPLEMENTATION-ADMISSION — 2026-09-28

Status: **IMPLEMENTATION_ADMITTED / EVIDENCE_PENDING**

## Decision

AUTH-004 may proceed to the smallest W01 implementation slice required to expose the already-contracted public API through Payload-native password lifecycle operations.

The implementation is a **thin adapter only**. The existing Payload-native authentication/recovery boundary remains authoritative.

## Authoritative baseline

- Feature contract: `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- Field contract: `contracts/entity/AUTH-004-password-recovery-field-contract.v1.json`
- Native implementation decision: `docs/change-control/CC-AUTH-004-PAYLOAD-NATIVE-REVERSION-2026-09-26.md`
- Evidence/mapping reconciliation: `contracts/alignment/mapping-batches/AUTH-004-real-evidence-reconciliation.v1.md`
- Evidence Registry binding: `docs/change-control/CC-MAPPING-0-AUTH-004-EVIDENCE-REGISTRY-BINDING-2026-09-28.md`
- Authoritative Contract Admission validation: workflow `36400819021`
- Authoritative Mapping 0 Structural validation: workflow `36400819042`
- Current main implementation baseline: `1f0368f46a45fca3e688a87530e6a8ae90d0213a`

## Admitted implementation slice

Only W01 Payload public-boundary adapters for these existing operation IDs:

- `authPasswordChange` → `POST /auth/password/change`
- `authPasswordResetRequest` → `POST /auth/password/reset/request`
- `authPasswordResetConfirm` → `POST /auth/password/reset/confirm`

The adapters must delegate to the existing Payload-native users/auth capability:

- password change → authenticated Payload native user update/password semantics
- reset request → Payload `forgotPassword`
- reset confirm → Payload `resetPassword`

The adapters must preserve the canonical contract for validation, HTTP status, cache policy, secret non-disclosure, authorization scope, single-use recovery semantics, expiry, replay denial, and session invalidation.

## Explicit non-goals

- No W02 password-recovery subsystem.
- No custom recovery table.
- No custom recovery token hash/persistence model.
- No AUTH-004 migration.
- No Payload core modification or fork.
- No new Worker, D1 database, queue, cache, saga, or cross-Worker transaction.
- No alternate password-recovery source of truth.
- No relaxation of the existing AUTH-004 security contract.
- No claim of runtime, persistence, security-E2E, lifecycle, event, or Mapping 0 GREEN.

## File-scope boundary

The implementation should remain inside the existing W01 Payload application/auth surface. The preferred shape is one thin route adapter per contracted public operation, with shared helper code only when required to avoid duplicated security-sensitive translation logic.

No unrelated AUTH or W02 refactor is admitted by this control.

## Contract and reconciliation rule

No Blueprint or canonical AUTH-004 API/DTO/field contract change is required by this admission. Those definition-layer artifacts were reconciled before implementation admission.

Any discovered contract mismatch must stop implementation and return to Change Control; code must not redefine the contract.

## Evidence requirements after implementation

The implementation cannot be promoted from `IMPLEMENTATION_ADMITTED` to GREEN merely because it builds.

Required executable evidence includes, at minimum:

1. controlled W01 remote behavior through the public `/auth/password/*` paths;
2. HTTP E2E verification of all three operation IDs;
3. anonymous reset-request enumeration resistance;
4. reset token replay and expiry rejection;
5. password/material secret non-disclosure;
6. successful password change/reset session invalidation;
7. lifecycle/event evidence required by the canonical contract;
8. exact source SHA provenance and Evidence Registry admission;
9. final Mapping 0 admission remains separately required.

Existing local AUTH-004 evidence remains valid and must not be rerun merely because this adapter is added.

## Gate boundary

This control authorizes implementation only. AUTH-004 remains **BLOCKED / NOT_GREEN** until executable evidence satisfies the canonical contracts and Mapping 0 admission.

## Backup

Pre-change backup branch:

`backup/main-before-auth004-native-adapter-admission-20260928`

## Governing principle

**Payload native capability > thin adapter if necessary > custom subsystem only by explicit later Change Control.**

## Remote evidence execution checkpoint — 2026-09-28

- Local native lifecycle evidence is now VERIFIED at run `36411953998`.
- Remote E2E automation is now present at `.github/workflows/auth-004-remote-e2e.yml` with exact deployment-artifact provenance binding.
- The remote probe exercises the three contracted public password operations, cross-account denial, anonymous reset-request enumeration resistance, session invalidation, replay/expiry rejection, empty-success bodies, and secret non-disclosure.
- The workflow is deployment-bound to `W01 W02 Auth Binding Deploy`; no alternate deployment path is introduced.
- A current W01 deployment of the 3.90.2 source remains the required external execution boundary.
- Until that deployment and the resulting remote evidence succeed, AUTH-004 remains `BLOCKED / NOT_GREEN`.
