# Change Control — SOCIAL-003 Like/Reaction + SOCIAL-004 Comment/Reply — 2026-10-01

- Status: `CONTRACT-FIRST / VERIFICATION-PENDING`
- Repository authority: GitHub `main`
- Work branch: `work/social-follow-subscription-20261001`
- Depends on: SOCIAL-001 follow, SOCIAL-002 followers/following

## Scope
Close the contract/model boundary for the existing Social interaction APIs:
- like / unlike;
- comment / reply / list;
- comment edit / delete.

## Architecture
- Domain authority: Social / W05 / D1-02.
- No new Worker.
- No new D1 database.
- No new Task.
- No Payload Collection.
- Content/W03 remains unchanged.
- Counters are derived and rebuildable.
- Cache is never authoritative.
- Moderation remains owned by the existing moderation authority.

## Reaction
`ENT-SOCIAL-REACTION` uses one effective reaction per actor + target + reactionType. Like/unlike remain idempotent and use the existing `InteractionTarget` DTO semantics.

## Comment
`ENT-SOCIAL-COMMENT` owns durable comment/reply state. `parentId` is bounded to the same content target and depth <= 3. Author identity and lifecycle state are server-authoritative. Deletion is durable state, not silent physical removal.

## Verification boundary
Contract closure does not claim runtime, migration, remote D1 evidence, moderation E2E, concurrency E2E, event delivery evidence or production GREEN.

## Next gate
W05 implementation admission -> controlled D1-02 migration -> runtime/concurrency/security evidence -> Evidence Registry reconciliation.
