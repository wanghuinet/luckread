# Worker Layout Change Control — Retire Legacy W04 Social Directory

Status: EXECUTED
Date: 2026-10-01

## Scope

Retire the historical `workers/W04-social/` directory because it is non-canonical and contains no executable implementation.

## Authority

- Canonical Worker Master: `docs/04-WORKER-MASTER-v1.0.md`
- Frozen topology: 12 Workers / 4 D1 domains / 25 Contract Tasks
- Canonical W04 source: `workers/W04-feed-search`
- Historical `workers/W04-social` is explicitly non-authoritative in Mapping-0 reconciliation records.

## Reconciliation

- W01–W12 root Worker count remains exactly 12.
- No W00 or W13+ Worker root directory exists.
- `workers/W04-feed-search` is the active W04 physical source and is referenced by current AUTH-013 provisioning/evidence workflows.
- `workers/W04-social/README.md` is the only file in the legacy directory.
- No workflow, Contract, or Evidence requires `workers/W04-social` as an executable source; references are historical reconciliation records.

## Change

Delete the sole file `workers/W04-social/README.md`, thereby retiring the empty legacy directory from the repository.

## Non-changes

- Do not rename or recreate W04.
- Do not change Worker count.
- Do not change D1 topology.
- Do not modify W04 Feed/Recommendation/Search implementation or AUTH-013 evidence.
- Do not change W05 or any other Worker.

## Rollback

Backup branch created before change:
`backup/pre-w04-social-cleanup-20261001`

Source main SHA before change:
`422f50440257da015f2fe02817745601d99c8405`
