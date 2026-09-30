# AUTH-013 Public Transport Dependency Record — 2026-09-25

- Feature: AUTH-013
- Status: **BLOCKED_EXTERNAL / DEPENDENCY_RECORDED**
- Scope: public `transitionAccountState` transport and security E2E dependency
- Repository authority: GitHub `main`

## Verified facts

1. The canonical AUTH-013 operation is already admitted as:
   - method: `POST`
   - path: `/v1/users/{userId}/account-state`
   - operationId: `transitionAccountState`
   - public boundary: W01
   - authoritative business Worker: W02 / D1-01

2. The W01 `W02_AUTH` Service Binding is already PASS_VERIFIED.

3. The W02 account-state kernel requires authoritative `actor`, `permission`, optional approval level, and precondition inputs. These inputs cannot be trusted from a public client request.

4. Current W01 source inspection does not establish an admitted public AUTH-013 route implementation.

5. Current W01/W02 repository evidence does not establish a verified runtime mechanism that resolves the authenticated caller into the required W02 actor/permission context for AUTH-013.

6. The existing E6 runtime cursor remains controlled `authLogin/authRefresh` runtime evidence. No current GitHub Actions workflow in the repository provides a verified end-to-end execution result for that runtime boundary.

## Decision / dependency

The public AUTH-013 runtime and security E2E gate is **blocked on the existing E6 authentication/runtime boundary**.

The correct order is:

`W01 authentication/session runtime → trusted principal/authorization context → W01→W02 AUTH-013 transport → lifecycle/security E2E`

No shortcut is admitted.

## Forbidden

- Do not accept client-supplied `actor.type`, permission, or approval level as authoritative.
- Do not create a parallel W01 authorization implementation for AUTH-013.
- Do not add a public route solely for smoke evidence.
- Do not bypass E6 `authLogin/authRefresh` runtime integration.
- Do not add a Worker or D1.
- Do not change the canonical AUTH-013 operation, Worker ownership, or D1 authority.

## Separate lifecycle dependency

The Feed/Recommendation/Search side-effect boundary is independently blocked until an executable W04 projection/deindex runtime is admitted. Canonical Worker Master defines W04 as a derived/projection boundary with no authoritative D1. No W04 implementation is inferred from the legacy physical `workers/W04-social` directory.

## Current disposition

AUTH-013 remains **BLOCKED_NOT_GREEN**.

Already-verified AUTH-013 transport, journal, Queue, W06, D1-03, and session-invalidation evidence is inherited and must not be repeated.

### Next admissible item

`E6 Runtime-003 — controlled authLogin/authRefresh runtime binding/evidence`.

Only after that dependency is green should the public AUTH-013 transport and its security E2E gate be admitted.
