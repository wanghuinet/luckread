# Luckread P0 — R3 Feature → L1/L2/L3/L4 Exact Crosswalk Gate v1.0

**Status:** IMPLEMENTED / FAIL-CLOSED / CANDIDATE GENERATION ENABLED

## 1. Objective

Create a deterministic bridge from the active Blueprint Feature inventory to the recovered historical L1-L4 hierarchy without inventing semantic relationships.

## 2. Authority

The active Blueprint remains authoritative for Feature IDs and feature meaning:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

The historical hierarchy is evidence only:

`contracts/capability/recovery/l1-l4-historical-hierarchy.parsed.json`

## 3. Matching rule

The only automatic `MATCH` rule is exact normalized Feature-name equality.

Normalization is limited to case, whitespace, quote, slash and dash representation. This is a mechanical comparison, not semantic similarity.

Forbidden automatic matches:

- name similarity;
- synonym inference;
- parent-domain inference;
- API similarity;
- database/Payload collection similarity;
- Feature-ID similarity;
- guessed L2/L3 parents;
- historical document authority promotion.

## 4. Output states

- `MATCH`: exactly one historical L4 has an exact normalized name match.
- `DUPLICATE`: multiple historical L4 candidates match exactly; blocked.
- `UNRESOLVED`: no exact historical L4 match; explicit reconciliation required.

`MATCH` is still evidence, not a final contract freeze. It must later reconcile owner, domain, entity, API, Worker, permission, state, event, NFR, migration and test evidence.

## 5. Implementation

Generator:

`scripts/build-feature-l1-l4-exact-crosswalk.mjs`

Output:

`contracts/capability/recovery/feature-l1-l4-exact-crosswalk.v1.json`

The generated output is explicitly marked `RECOVERY_CANDIDATE_ONLY` and must not itself promote the Capability Contract Graph to GREEN.

## 6. Next stage

After the exact crosswalk is generated, the remaining unmatched features are reconciled in controlled batches using explicit historical evidence or direct Blueprint evidence. No batch may silently convert `UNRESOLVED` to `MATCH`.
