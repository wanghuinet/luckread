# CC-MAPPING-0-CURSOR-SOURCE-SHA-RECONCILIATION-2026-09-27

## Status

`PROVENANCE_RECONCILED / NOT_GREEN`

## Change

The authoritative Mapping 0 cursor already points to current `main` at `1a1e097dff6334dee8878d098c772bedaa6cb87e`, but the nested `currentSourceReconciliation.mainSha` remained at the prior governance-baseline commit.

This change aligns that single provenance field to the current `main` head.

## Boundary

No runtime behavior, contract semantics, policy value, Worker/D1 topology, Evidence Registry promotion, or Mapping 0 GREEN state changes.

Historical evidence source SHAs remain unchanged because they identify the exact evidence-producing revisions.

## Backup

`backup/pre-cursor-source-reconciliation-sha-20260927`
