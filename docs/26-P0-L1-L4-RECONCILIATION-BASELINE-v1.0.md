# LuckRead L1-L4 Reconciliation Baseline v1.0

**Status:** RECONCILIATION-IN-PROGRESS / NOT-GREEN

## 1. Authority

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` is the current functional source of truth. This baseline does not create a second feature inventory.

Historical matrices, including `docs/39-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-MATRIX-v1.0.md`, are reconciliation inputs only. The historical matrix explicitly defines the intended direction `L1 → L2 → L3 → L4 → Data/API/Event/Permission/Security/Cost/Test` and identifies incomplete L4 ownership as an admission blocker. fileciteturn41file0

## 2. Reconciliation states

Each capability must resolve to exactly one of:

- `MATCH` — Blueprint Feature ID and historical responsibility agree.
- `BLUEPRINT_ONLY` — current Blueprint capability has no historical responsibility anchor.
- `LEGACY_ONLY` — historical capability has no current Blueprint Feature ID; do not import silently.
- `CONFLICT` — same responsibility is assigned to materially different owners or hierarchy positions.
- `DUPLICATE` — multiple current records claim the same Feature ID.
- `UNRESOLVED` — L1/L2/L3/L4 hierarchy cannot be established without invention.

## 3. Admission rule

Only `MATCH` and explicitly reviewed `BLUEPRINT_ONLY` records may enter the Capability Contract Graph. `LEGACY_ONLY`, `CONFLICT`, `DUPLICATE`, and `UNRESOLVED` remain blocking states.

## 4. Current baseline

The Blueprint contains stable Feature IDs across the complete domain inventory and explicitly requires every implemented capability to exist in the Blueprint before implementation. It also requires eventual mapping to API, data, permission/scope, state, client, admin, security, audit, analytics, localization and tests where applicable.

The Capability Contract Graph is intentionally still `NOT_GREEN` with an empty feature registry. No historical matrix is being bulk-imported until ownership and hierarchy are reconciled mechanically.

## 5. Next admission step

Populate reconciliation evidence from the current Blueprint first, then compare historical matrices only to detect missing ownership, hierarchy conflicts and legacy-only responsibilities. After all blocking states are resolved, populate the Capability Contract Registry in controlled batches.
