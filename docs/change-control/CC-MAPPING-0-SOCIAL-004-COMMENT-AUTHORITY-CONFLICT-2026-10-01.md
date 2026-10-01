# Change Control: SOCIAL-004 Comment Authority Reconciliation — 2026-10-01

- Status: RESOLVED_CONFLICT / IMPLEMENTATION_STILL_BLOCKED
- Feature: SOCIAL-004 comment/reply
- Canonical Worker Master owner: W05 / T11 / D1-02
- Reconciled artifact: `contracts/enums/comment-state.json`

## Decision

The active Worker Master is the canonical ownership source for the frozen 12-Worker topology. W05 owns Social / Community / Messaging / Notification and T11-T14. The prior `W00` value in CommentState was a stale legacy declaration and has been reconciled to W05.

This resolves the **writer-owner conflict only**. It does not grant Comment runtime implementation admission.

## Controls

1. Comment lifecycle state remains in D1-02.
2. W05 is the authoritative Comment runtime writer boundary when SOCIAL-004 implementation is later admitted.
3. W06 remains the Rights / Trust & Safety / Governance authority for moderation decisions; moderation outcomes must not be confused with Comment ownership.
4. No Comment migration, public route, runtime GREEN or Evidence Registry PASS is implied by this reconciliation.
5. SOCIAL-004 still requires the remaining API/DTO/entity/field/persistence/policy/anti-abuse/idempotency/runtime/security evidence before implementation admission.

## Related authority

- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- `contracts/enums/comment-state.json`
- `contracts/api/interaction-operation-policy.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`
- `contracts/alignment/five-way-reconciliation.v1.json`

## Result

The stale W00/W05 ownership contradiction is closed. The feature remains **BLOCKED / NOT_GREEN** on its independent implementation-admission requirements.
