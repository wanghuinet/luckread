# Change Control — Mapping 0 Canonical Mapping Generator Drift

- ID: CC-MAPPING-0-CANONICAL-MAPPING-GENERATOR-DRIFT-2026-09-17
- Date: 2026-09-17
- Scope: Mapping 0 canonical mapping artifact + its schema (no code/schema change in this record)
- Decision: Record the conflict as GAP; do not modify the schema or the artifact now. Await Change Control authorization before altering either authoritative source.

## Problem

`contracts/alignment/cross-system-mapping.v1.schema.json` declares the canonical generator and shape as:

- `generatedBy` = `const "scripts/consolidate-mapping-batches.mjs"`
- `generatedDeterministically` = `const true`
- `recordCount` (required)
- `generatedDeterministically` (required)

The committed `contracts/alignment/cross-system-mapping.v1.json` is actually produced by:

- `scripts/materialize-canonical-mapping.mjs` (record `generatedBy` = `scripts/materialize-canonical-mapping.mjs`)
- followed by the `reconcile-canonical-*.mjs` series

and it is missing the schema-required `generatedDeterministically` and `recordCount` top-level fields.

Running the schema-declared generator today reproduces a divergent artifact that fails the structural gate:

- `scripts/consolidate-mapping-batches.mjs` → `NOT_GREEN; records=461; canonical=449; missing-batch-records=186; orphan-mappings=12`
- 12 orphan records reference non-canonical Feature IDs; 186 canonical features have no `B<number>*.json` batch record.

`scripts/consolidate-mapping-batches.mjs` is not invoked by any current CI workflow (`mapping-0-verify.mjs` runs the structural gate; `alignment-ci.mjs` consumes the canonical mapping as an authoritative input and does not regenerate it).

## Impact

1. The schema and the actual generator are inconsistent. The schema's `generatedDeterministically: true` claim is not reproducible through the schema-declared generator.
2. No current CI validator enforces `generatedBy` / `generatedDeterministically` / `recordCount`, so the drift is latent: the structural gate remains GREEN because it validates record identity/arrays only, not the schema consts.
3. The batch-file path (`B<number>*.json`) no longer covers the full canonical Feature Inventory (186 of 449 unmatched), while the materialize + reconcile path does maintain 1:1 coverage.

## Reconciliation requirement (proposed, not executed)

Choose and authorize one authoritative generator for `cross-system-mapping.v1.json`:

- Option A — update the schema to reflect `materialize-canonical-mapping.mjs` + reconcile as the generator, correcting `generatedBy` and the `generatedDeterministically`/`recordCount` contract.
- Option B — make `consolidate-mapping-batches.mjs` the only generator and migrate all 449 canonical records into the `B<number>*.json` batch hierarchy (larger, riskier).

Neither option is executed here. This record preserves the conflict, its sources, difference, and impact for a later Change Control decision.

## Non-goals

- No business code, D1 migration, Payload collection, or Worker change.
- No change to the 11 GPT-owned records.
- No conversion of `UNRESOLVED`/`PARTIAL`/`MISSING` into false implementation claims.

## Resolution (2026-09-18) — authorized Option A, executed

- Authorization: user selected **Option A** — align the schema to the real generator (`materialize-canonical-mapping.mjs` + reconcile) rather than migrate 449 records into the `B<number>*.json` hierarchy.
- Changes applied (schema + generator + CI orchestration only; no record content, no GPT record, no business code):
  1. `contracts/alignment/cross-system-mapping.v1.schema.json`: `generatedBy` const corrected to `scripts/materialize-canonical-mapping.mjs`.
  2. `scripts/materialize-canonical-mapping.mjs`: now always emits a deterministic top-level object including `generatedDeterministically: true` and `recordCount`, deriving `status` from blocking record count, and preserving existing records and the curated top-level `blockers`.
  3. `contracts/alignment/cross-system-mapping.v1.json`: regenerated to carry the schema-required `generatedDeterministically`, `recordCount`, and correctly ordered top-level `blockers`; all 449 records byte-for-byte unchanged.
  4. `.github/workflows/contract-ci.yml`: alignment job now runs `materialize-canonical-mapping.mjs` (not the divergent `consolidate-mapping-batches.mjs`) and includes `cross-system-mapping.v1.json` in the deterministic `git diff --exit-code` check.
- Verification: re-running the generator is idempotent (same diff, no further drift); all 8 schema-required top-level fields present; `recordCount === records.length === 449`; `generatedBy` now matches the schema const. The `mapping-0` structural gate remains GREEN.
- Not resolved here (by design): the canonical mapping `status` stays `NOT_GREEN` because 449 records retain blocking status/blockers — this reflects the absence of downstream implementation/contract evidence and must not be promoted to GREEN by inference.