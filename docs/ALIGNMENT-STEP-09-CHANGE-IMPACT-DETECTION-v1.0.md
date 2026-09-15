# ALIGNMENT STEP 09 — Change Impact Detection v1.0

## Purpose

Step 09 converts five-way reconciliation into deterministic change-impact analysis. A feature change must not silently leave Database, API, Payload, Code, tests, migrations, events, or authorization behind.

## Rules

1. Blueprint feature IDs are authoritative; no inferred feature IDs.
2. Cross-system mappings are explicit; no fuzzy semantic matching.
3. Missing mapping is BLOCKED, not unchanged.
4. Drift, conflict, duplicate, missing, extra, unresolved, or blocked reconciliation states create impact work.
5. Impact output is generated, not manually maintained.
6. A GREEN impact inventory is permitted only when every feature has deterministic mapping and no unresolved reconciliation state.

## Input

- `contracts/alignment/feature-inventory.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`
- `contracts/alignment/five-way-reconciliation.v1.json`

## Output

- `contracts/alignment/change-impact.v1.json`
- schema: `contracts/alignment/change-impact.v1.schema.json`
- generator: `scripts/build-change-impact.mjs`

## Meaning

`UNCHANGED` means the currently known mapped systems have no detected reconciliation blocker. It does not claim the feature is implementation-complete.

`MODIFIED` means reconciliation identifies a state requiring downstream review or revalidation.

`BLOCKED` / `UNRESOLVED` means the system lacks sufficient authoritative mapping/evidence and must not guess.

## Gate position

Step 09 runs after cross-system reconciliation and before CI enforcement. It is a change-safety gate, not a feature-completeness gate.
