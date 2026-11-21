# CC-MAPPING-0-AUTH-013-W04-RUNTIME-EVIDENCE-ADMISSION-2026-09-29

## Status

`APPROVED_FOR_EVIDENCE_RECONCILIATION`

## Scope

Admit the controlled AUTH-013/W04 projection runtime evidence for the already-authorized
derived destination and existing queue/consumer topology.

No new Worker, D1, Queue, KV namespace, public route, Contract/OpenAPI semantic,
Payload Core change, or topology expansion is introduced.

## Exact runtime evidence

- Main source: `53e3bcbb855be8e1240171390c69dd034bf04f8b`
- Workflow: `.github/workflows/w04-physical-provision.yml`
- Run: `36522900537`
- Job: `109259476025`
- Worker: `luckread-w04`
- Worker Version ID: `83e69e13-104c-482f-bc4c-2176bc9ef824`
- Queue: `luckread-auth013-account-state-projection`
- DLQ: `luckread-auth013-account-state-projection-dlq`
- Derived destination: Cloudflare KV `globe`
- Namespace ID: `32f7e407128a43d59720d5d46736e084`
- Destination authority: `NONE`

## Verified assertions

The controlled runtime evidence completed successfully and verified:

1. W04 queue consumer is `luckread-w04`.
2. Exactly one consumer is attached to the dedicated projection queue.
3. The configured DLQ is the dedicated AUTH-013 projection DLQ.
4. `v1 FROZEN` converges to projection `PURGED`.
5. `v2 RESTORED` converges to projection `ACTIVE`.
6. An older version is rejected and cannot regress the projection.
7. Duplicate delivery is idempotent.
8. A stale/older event cannot resurrect a purged resource.
9. Synthetic KV evidence state is cleaned after the probe.

## Admission decision

Admit one executable PASS evidence record:

`EVD-AUTH013-W04-PROJECTION-RUNTIME-001`

Claim:

`AUTH-013::W04_PROJECTION_RUNTIME`

This closes only the W04 projection runtime sub-gate. AUTH-013 remains `PARTIAL` /
`BLOCKED_NOT_GREEN` because feature-wide lifecycle transition coverage and complete
cache/deindex/feed/search convergence are still unproven.

## Controls

- Backup: `backup/pre-auth013-w04-evidence-admission-20260929`
- Working branch: `reconcile/auth013-w04-evidence-admission-20260929`
- Evidence boundary: do not rerun Run `36522900537` unchanged.
- Do not promote AUTH-013 GREEN from this single runtime slice.
