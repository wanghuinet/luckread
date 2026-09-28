# CC-MAPPING-0-AUTH-001-CURSOR-POST-MIGRATION-RECONCILIATION-2026-09-28

- Status: CURRENT CURSOR RECONCILED / NEXT GATE = W02 MATERIALIZER REMOTE RUNTIME EVIDENCE
- Current main: `37b0473f7214dd4eaca0326d147973e44fe52e7e`
- Backup: `backup/main-before-auth001-materializer-rerun-20260928-1335`
- Work branch: `governance/auth001-cursor-post-merge-20260928`

## Reconciled facts

1. Controlled AUTH-001 registration/consent migration evidence passed on run `36379124829` against source `b6eab1eae17a825103c0a3b3a6c80daf570e8ff3`.
2. That evidence was registered and merged in PR #140, producing current main `37b0473f7214dd4eaca0326d147973e44fe52e7e`.
3. The earlier W02 materializer runtime run `36377880967` checked out source `bd2791a4ca799126fac16afbc0506070e9074a77` and failed closed with `synthetic_collision`.
4. The failed run remains FAIL evidence and is not reclassified.
5. The materializer runtime is now the active AUTH-001 development evidence gate; the D1-01 physical schema prerequisite is no longer the blocker.
6. A failed-job rerun of run `36377880967` has been requested after the migration evidence became valid. Any resulting PASS must still be independently inspected and admitted before Evidence Registry promotion.

## Boundary

- No production Worker deployment.
- No Mapping 0 GREEN.
- No Evidence Registry GREEN promotion.
- No entity promotion.
- No rerun of already-verified AUTH-002/AUTH-003 evidence.
- No new Worker, Queue, D1 or Payload Core architecture.

## Next gate

`AUTH-001::W02_D1-01 registration materializer remote runtime evidence`

A successful controlled runtime evidence result is required before this gate can advance to canonical Evidence Registry admission and subsequent production-authority review.
