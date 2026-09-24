# AUTH-013 Side-Effect Integration Decision Input — 2026-09-24

- Feature: AUTH-013
- Status: DECISION_INPUT / IMPLEMENTATION_BLOCKED
- Scope: account-state transition Audit/Event/Cache/Session side effects
- Repository authority: GitHub main

## Verified facts

1. The canonical Worker Master is active and frozen at 12 Workers / 4 D1 domains.
2. The Worker Master assigns W06 = Rights / Trust & Safety / Governance with D1-03 authority.
3. The canonical Audit Event schema is `contracts/schemas/common/audit-event.json`.
4. The Audit Event schema declares D1-03 as the canonical domain and W06 as authoritative writer.
5. AUTH-013 lifecycle contracts require:
   - audit before/after state;
   - actor identity/type;
   - event `identity.account_state_changed`;
   - account-state cache version advancement;
   - token/session enforcement by resulting state;
   - deindex/projection convergence for the declared states.
6. Current repository search does not establish an executable W06 AuditEvent writer or an executable `identity.account_state_changed` producer.
7. Existing physical worker layout evidence records `workers/W06-media` as a historical/physical-layout mismatch against the canonical W06 responsibility. The current Worker Master forbids inferring Worker authority from directory names.

## What is already closed

- D1-01 AUTH-013 migration: PASS_VERIFIED.
- W02 account-state transition kernel: PASS_VERIFIED.
- W02 source test suite: 13/13 PASS.
- Mapping 0 structural/contract validator: SUCCESS after validator correction.

## Decision questions

A downstream implementation needs a canonical execution boundary for:

- immutable AuditEvent persistence;
- `identity.account_state_changed` event publication;
- cache invalidation/version propagation;
- token/session invalidation or re-authentication side effects;
- deindex/projection convergence.

Before implementation, the project must establish whether:

A. the existing W06 canonical worker/runtime is already implemented elsewhere and can be evidence-bound; or

B. the canonical W06 physical/runtime binding is still an open implementation task and must receive its own approved Worker/D1 binding + implementation admission.

## Forbidden actions

- Do not create a new Worker or D1.
- Do not treat `workers/W06-media` as canonical W06 authority by path name.
- Do not create an ad-hoc audit/event table in W02.
- Do not make W02 the authoritative AuditEvent writer.
- Do not emit unverified side effects and mark them as runtime evidence.
- Do not alter the frozen 12-Worker / 4-D1 topology.

## Current disposition

AUTH-013 remains **BLOCKED_NOT_GREEN** only for the downstream side-effect/integration/evidence chain. The W02 state-transition kernel and D1 persistence sub-gates remain verified and must not be repeated.
