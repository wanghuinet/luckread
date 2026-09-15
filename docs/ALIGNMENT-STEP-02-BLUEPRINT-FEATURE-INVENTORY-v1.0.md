# Alignment Step 02 — Blueprint Feature Inventory v1.0

## Status

**IMPLEMENTED / GATE-ENFORCED / NOT_GREEN UNTIL GENERATED INVENTORY IS COMMITTED**

## Purpose

Convert the active Blueprint feature IDs into a machine-readable inventory before any feature is admitted into the five-way alignment model.

Authoritative source:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

## Non-negotiable rules

1. A feature must have an explicit Blueprint Feature ID.
2. The generator may only discover IDs explicitly present in the Blueprint.
3. The generator must never invent, rename, merge, split, or semantically infer Feature IDs.
4. Duplicate Feature IDs are collapsed only for inventory generation; the source Blueprint remains authoritative and duplicate-source occurrences are an audit concern.
5. The inventory is a discovery index, not a replacement for the Blueprint.
6. Missing or untracked generated inventory is a CI failure.
7. This step does not authorize implementation. Implementation remains blocked until the later alignment and contract gates are satisfied.

## Output

`contracts/alignment/feature-inventory.v1.json`

Schema:

`contracts/alignment/feature-inventory.v1.schema.json`

Generator:

`scripts/build-feature-inventory.mjs`

## Generated record

Each discovered feature contains only facts that can be derived without semantic inference:

- `featureId`
- `name`
- `sourceRef`
- `alignmentState`

DB, API, Payload, Code and Evidence mappings are deliberately absent here. Those belong to later alignment steps.

## Verification

Local commands:

```text
npm run feature:inventory
npm run feature:inventory:verify
```

CI runs the generator and fails closed if the generated inventory is absent, modified, or untracked.

## Why this is separate from the existing reconciliation baseline

The historical L1-L4 reconciliation baseline is evidence for hierarchy reconciliation. This inventory is the direct machine-readable index of the current active Blueprint and is therefore the admission source for the new five-way alignment pipeline.

## Step 02 exit condition

Step 02 becomes GREEN only when the generated inventory is committed and reproducible from the current Blueprint with zero working-tree drift.
