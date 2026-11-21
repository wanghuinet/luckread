# Phase 5 — Social Interaction Mapping v1.0

**Status:** MAPPING_BASELINE / NOT_GREEN_UNTIL_EVIDENCE

## Scope
- Like / unlike
- Comment / reply / thread
- Favorite / unfavorite
- Follow / unfollow
- Share event boundary
- Mention
- Report
- Block / mute
- Interaction counters and consistency

## Unified interaction model
Article and video interactions should use shared contracts where semantics are identical, while domain-specific behavior remains explicit.

## End-to-end closure
`Authenticated user -> Permission check -> Interaction command -> Idempotency/concurrency control -> Persist -> Counter/event update -> Response/notification handoff`

## Required mappings
S01 interaction identity; S02 target ownership; S03 command semantics; S04 idempotency; S05 concurrency; S06 authorization; S07 deletion/state rules; S08 thread/reply model; S09 follow graph; S10 report/block/mute; S11 counters; S12 notification handoff; S13 auditability.

## Invariants
- A user cannot create an unauthorized interaction.
- Repeated idempotent commands do not create duplicate logical state.
- Concurrent like/follow/comment operations have defined conflict semantics.
- Deleted/blocked/restricted content follows explicit visibility rules.
- Local/internal APIs cannot bypass authorization.

## Exit gate
All interaction paths require integration/E2E and concurrency evidence, not only happy-path unit tests.
