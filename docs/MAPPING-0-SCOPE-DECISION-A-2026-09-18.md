# Mapping-0 Scope Governance Decision A

Date: 2026-09-18
Repository: `wanghuinet/luckread`
Decision source: explicit user decision in conversation.

## Decision

**Option A — Keep the current Canonical Feature Inventory unchanged.** Extra claims outside the current canonical inventory are not included in Mapping-0 for now. Retain them and mark them as pending governance; do not silently delete, map, or promote them.

## Applied scope

The decision covers the three discrepancies recorded in the GPT acceptance review:

| Family | Canonical count | Reconciliation claim | Treatment under A |
|---|---:|---:|---|
| AI | 0 | 15 | Exclude extra claims from Mapping-0 pending governance; preserve source artifacts |
| ANALYTICS | 11 | 20 | Keep canonical scope at 11; treat 9 extra claims as pending governance |
| GROWTH | 10 | 14 | Keep canonical scope at 10; treat 4 extra claims as pending governance |

These counts are carried forward from the Batch G final sweep report as recorded in `docs/MAPPING-0-GPT-ACCEPTANCE-AND-REMAINING-CLOSURE-PLAN-2026-09-18.md`; this decision does not independently re-run that report.

## Constraints

1. Do not add any of the extra claims to the Canonical Feature Inventory or Canonical Mapping under this decision.
2. Do not delete, overwrite, or silently archive source artifacts; retain them and label/document their non-canonical pending status in subsequent disposition work.
3. Do not infer missing feature IDs, contracts, APIs, entities, fields, Payload collections, code edges, or runtime evidence.
4. Any later scope expansion requires a separate explicit change-control decision and corresponding Blueprint/Contract reconciliation.
5. This decision does not change the reported structural-green snapshot, clear the five-way reconciliation blockers, or authorize implementation.

## Next closure actions

- Reflect this decision in the discrepancy disposition register, preserving traceability to the source artifacts.
- Continue row-by-row disposition of the 58 unreferenced mapping-batch documents; do not bulk-delete or auto-wire them.
- Keep runtime/technical closure `NOT_GREEN` until authoritative contracts, executable implementation, tests, and commit-bound evidence exist.

## Status

Decision recorded. Implementation of the decision in canonical inventories and reconciliation artifacts remains pending verification; no such artifacts are claimed to have been updated by this record alone.
