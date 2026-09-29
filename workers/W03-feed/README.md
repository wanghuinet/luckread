# W03 — Content / Article / Media / Translation

Canonical Worker role: **Content / Article / Media / Translation**.

The repository path `workers/W03-feed` is a physical path retained for compatibility with existing repository history. It is not the logical role name.

Current authoritative ownership:
- Primary Tasks: T05, T06, T07, T15
- Primary D1 authority: D1-02
- Canonical source of responsibility: `docs/04-WORKER-MASTER-v1.0.md`
- Canonical feature mapping: `docs/02-FINAL-MAPPING-v1.0.md`

Content implementation boundary:
- Content/article/media/translation authoritative writes belong to W03 / D1-02.
- W04 owns feed/recommendation/search derived projections and is not the content source of truth.
- W01 remains the public API / Gateway boundary.
- No new Worker or D1 is introduced by this role reconciliation.

The previous README description of W03 as a feed/read-model boundary was a stale physical-path description and is superseded by the current canonical Worker Master. No historical document or topology is deleted or rewritten by this change.
