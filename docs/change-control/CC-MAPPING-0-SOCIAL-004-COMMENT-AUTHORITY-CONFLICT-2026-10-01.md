# Change Control: SOCIAL-004 Comment Authority Conflict — 2026-10-01

- Status: BLOCKED / DECISION_MATERIAL_REQUIRED
- Feature: SOCIAL-004 comment/reply
- Current canonical Worker Master owner: W05 / T11 / D1-02
- Conflicting legacy evidence: `contracts/enums/comment-state.json` names `W00` as authoritative writer.

## Conflict

The active Worker Master defines a 12-Worker topology with W05 as the Social / Community owner of T11-T14. The existing CommentState enum still contains a historical `W00` authoritative-writer declaration.

These statements cannot both be authoritative.

## Control

1. No Comment runtime, migration, entity-owner promotion or Evidence Registry PASS is admitted while the conflict remains unresolved.
2. The CommentState enum is not rewritten in this slice because it is an existing contract artifact with historical provenance.
3. The decision must explicitly select the active owner and then reconcile the affected contract references in a dedicated Change Control.
4. Until the decision is recorded, Comment remains BLOCKED_NOT_GREEN.

## Related evidence

- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- `contracts/enums/comment-state.json`
- `contracts/api/interaction-operation-policy.v1.json`
- `contracts/alignment/mapping-batches/SOCIAL-001-010-real-evidence-reconciliation.v1.md`

## STOP conditions

- Do not invent a second Comment authority.
- Do not create a W00 directory or Worker.
- Do not execute a Comment migration.
- Do not claim SOCIAL-004 implementation GREEN.
