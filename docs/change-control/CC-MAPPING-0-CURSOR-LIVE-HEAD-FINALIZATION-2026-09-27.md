# CC-MAPPING-0-CURSOR-LIVE-HEAD-FINALIZATION-2026-09-27

## Status

`CURRENT_HEAD_PROVENANCE_ALIGNED / NOT_GREEN`

## Change

After the prior cursor provenance reconciliation was merged, `main` advanced again to:

`d6a6cf225c4f5ac9599c30949fc4143df04c932b`

This change aligns all live-current Mapping 0 cursor fields to that actual `main` head:

- `sourceHead`
- `currentHeadReconciliation.currentMainSha`
- `currentSourceReconciliation.mainSha`

The immediately prior head `1a1e097dff6334dee8878d098c772bedaa6cb87e` is retained as `previousSourceHead`.

## Boundary

No runtime, contract, policy-instance, Worker/D1, Evidence Registry, or Mapping 0 status change.

Historical evidence-producing SHAs remain untouched.

## Backup

`backup/pre-cursor-live-current-head-finalize-20260927`
