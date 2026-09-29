# AUTH-013 Side-Effect Integration Decision Input — 2026-09-24

- Feature: AUTH-013
- Status: RECONCILED / IMPLEMENTATION-BLOCKED-FOR-REMAINING-SIDE-EFFECTS
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
6. Controlled runtime evidence now establishes the canonical W02 → Queue → W06 → D1-03 AuditEvent path. Positive Runtime Transport Run `36090709083` completed successfully and retained the immutable D1-03 AuditEvent produced by the real consumer path.
7. Controlled W06 deployment and Queue consumer evidence establish W06 as the executable AuditEvent writer/runtime boundary. Historical directory names remain non-authoritative; no binding is inferred from `workers/W06-media`.
8. Controlled AUTH-013 Public HTTP E2E Run `36503534440` separately establishes the public W01 → W02 security/concurrency boundary and D1 authoritative state/session checks.

## What is already closed

- D1-01 AUTH-013 migration: PASS_VERIFIED.
- W02 account-state transition kernel: PASS_VERIFIED.
- W02 source test suite: 13/13 PASS.
- W06 physical binding/deployment and Queue consumer: PASS_VERIFIED at their admitted scopes.
- Real W02 → Queue → W06 → D1-03 AuditEvent transport/persistence: PASS_VERIFIED.
- AUTH-013 public HTTP E2E: PASS_VERIFIED for tested ACTIVE → RESTRICTED / session-security scope.
- Mapping 0 structural/contract validator: SUCCESS after validator correction.

## Decision reconciliation

The earlier A/B question is now resolved by existing admitted runtime evidence:

- **A is established for the audit/event boundary:** the existing canonical W06 runtime and D1-03 boundary are physically deployed and have produced immutable AuditEvent evidence through the real Queue consumer path.
- **B is not required for the audit/event boundary:** no new Worker, D1, direct W02 → D1-03 writer, or alternate topology is justified.

The remaining implementation question is narrower and unchanged in principle: how the existing canonical cache/feed/search/projection contracts are executed and evidenced for the AUTH-013 lifecycle states. That work must use the already frozen Worker/D1 topology and existing ownership rules.

## Forbidden actions

- Do not create a new Worker or D1.
- Do not treat `workers/W06-media` as canonical W06 authority by path name.
- Do not create an ad-hoc audit/event table in W02.
- Do not make W02 the authoritative AuditEvent writer.
- Do not emit unverified side effects and mark them as runtime evidence.
- Do not alter the frozen 12-Worker / 4-D1 topology.

## Current disposition

AUTH-013 remains **BLOCKED_NOT_GREEN** only for the remaining cache/deindex/projection convergence and feature-wide lifecycle evidence. The W02 state-transition, D1 persistence, W06 AuditEvent transport/persistence, and public HTTP E2E sub-gates are verified and must not be repeated.
