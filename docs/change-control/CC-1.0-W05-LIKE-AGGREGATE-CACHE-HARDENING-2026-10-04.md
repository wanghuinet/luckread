# Change Control — W05 Like Aggregate Cache Hardening — 2026-10-04

Status: MERGED / RELEVANT-CI-VALIDATED / RUNTIME-EVIDENCE-PENDING

## Baseline
- authoritative main before slice: `36e9f5ad8cf059bf394d7010d2ce631774f232fd`
- backup: `backup/2026-10-04-pre-w05-counter-read-hardening`
- working branch: `superpowers/w05-counter-read-hardening`
- merged main: `3e112938fa03184255bcf3f7e12bacfdd03eaff4`
- pull request: #646

## Gap
W05 `getLikeStatus` currently combines viewer-specific like state with a target-wide `COUNT(*)`. Its 5-second cache key contains the actor, so the public aggregate is duplicated across viewers and hot content can repeatedly re-enter D1.

## Decision
- Keep authoritative like relationships in `interaction_likes` (D1-02).
- Keep viewer-specific `liked` state in a private actor/target cache.
- Store target-wide `likeCount` in a separate shared cache key.
- Shared aggregate cache TTL is 5 seconds and may be stale for at most that cache interval.
- Viewer-state invalidation remains immediate on like/unlike.
- Shared aggregate cache is intentionally not synchronously invalidated by every like/unlike; expiry bounds staleness and avoids turning high-frequency mutations into synchronous cache fan-out.
- No new Worker, D1, table, queue, or authoritative field.

## Non-goals
- No persistent follower/like counter projection.
- No change to authorization or interaction authority.
- No change to public API shape.
- No Mapping 0 promotion.

## CI Evidence

The merged PR #646 exact head `29efc124c1aee0942a662473cea3ab3f725aef78` produced:

- W05 Social Runtime CI: run `37180481812` — PASS
- API Contract CI: run `37180481756` — PASS
- 1.0 D1 Traffic Guard Contract CI: run `37180481763` — PASS
- Worker D1 Access Boundary Gate: run `37180481787` — PASS
- Worker Directory Drift Gate: run `37180481864` — PASS
- Security Hardening Gate: run `37180481797` — PASS
- Mapping 0 Structural Gate: run `37180481809` — PASS
- Contract Admission CI: run `37180481865` — PASS

API Inventory Reconciliation run `37180481788` reported a pre-existing project-wide inventory/evidence gap and did not identify a failure in the four changed PR files. This Change Control does not reclassify that baseline issue as a Like Aggregate defect.

## Acceptance

The scoped shared aggregate cache behavior and bounded D1-read hardening passed the relevant CI gates. No production runtime claim is made here until independent deployment/runtime evidence is recorded.
