# P0 — L1-L4 Hierarchy Source Recovery Contract v1.0

## Status
`RECOVERY-IDENTIFIED / NOT_GREEN`

## Decision
The 449-feature Blueprint inventory is complete, but the current formal Capability Graph cannot be admitted because the reconciliation baseline contains L1-only records while L2/L3/L4 are unresolved.

A historical L1-L4 authority candidate is recoverable from Git history:
`docs/36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md`
Original blob SHA: `cfe71759e470f93ca85b43196961913f7c5afc63`.

The repository archive explicitly marks this document as superseded/non-authoritative after the 2.0 transition. It is therefore evidence for recovery, not automatically the current source of truth.

## Evidence chain
1. Blueprint 2.0 remains the functional source of truth.
2. `contracts/capability/l1-l4-reconciliation-baseline.v1.json` is the current reconciliation workset.
3. `docs/39-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-MATRIX-v1.0.md` defines the required L1→L2→L3→L4→contract direction and historical L4 anchors.
4. The historical fourth-level matrix is recoverable from the recorded blob SHA and explicitly defines the four-level hierarchy and L4 implementation responsibilities.
5. The historical matrix cannot be promoted wholesale because Blueprint 2.0 may add, rename, split, merge, or supersede capabilities.

## Recovery procedure
### R1 — Recover
Recover the complete historical L4 matrix without changing its contents.

### R2 — Parse
Mechanically extract L1 heading, L2 heading, L3 heading, L4 item, source section, and original ordering. No semantic inference is permitted.

### R3 — Crosswalk
For every 449 Blueprint Feature IDs, compare current Blueprint names against the recovered hierarchy. Result enum: `MATCH`, `BLUEPRINT_ONLY`, `LEGACY_ONLY`, `CONFLICT`, `DUPLICATE`, `UNRESOLVED`.

### R4 — Reconcile
Only evidence-backed matches may receive resolved L2/L3/L4 values. Blueprint-only capabilities require explicit L3/L4 design under the existing admission classes. Legacy-only, conflict, duplicate, and unresolved records remain blocking.

### R5 — Admit
After blockers are resolved: update the reconciliation workset; run the checker; verify exact 449/449 coverage; verify hierarchy uniqueness; verify no unresolved/conflict/duplicate records; then project only admitted records into the formal Capability Contract Graph.

## Non-negotiable constraints
- Do not invent L2/L3/L4 from feature names.
- Do not use API routes, Payload collections, or database tables as hierarchy evidence.
- Do not import the historical matrix wholesale.
- Do not change Blueprint 2.0 merely to fit the historical hierarchy.
- Do not mark GREEN while blocking states remain.
- Do not begin API/Domain/DB projection as a substitute for hierarchy reconciliation.

## Current gate result
`INVENTORY = COMPLETE`
`HIERARCHY = RECOVERY REQUIRED`
`ADMISSION = BLOCKED`
`CAPABILITY_GRAPH = NOT_GREEN`
`API/DOMAIN/DB_PROJECTION = BLOCKED`

## Next executable artifact
A machine-readable recovered-hierarchy source plus a deterministic crosswalk checker, with the historical source preserved separately from current Blueprint reconciliation so historical data cannot silently become authoritative again.
