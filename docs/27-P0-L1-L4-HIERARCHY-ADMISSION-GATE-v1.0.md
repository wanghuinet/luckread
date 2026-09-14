# P0 — L1-L4 Hierarchy Admission Gate v1.0

## Status

`NOT_GREEN / ADMISSION_BLOCKED`

## Purpose

This gate is the next step after completion of the 449-feature Blueprint inventory. It prevents the Capability Contract Graph from becoming falsely green merely because every Blueprint Feature ID has been staged.

## Authoritative relationship

The functional source of truth remains:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

The reconciliation baseline is:

`contracts/capability/l1-l4-reconciliation-baseline.v1.json`

The formal graph remains a projection target:

`contracts/capability/capability-contract-graph.v1.json`

## Admission requirements

A feature may enter the formal Capability Contract Graph only when all of the following are true:

1. Feature ID exists exactly once in Blueprint 2.0.
2. Feature ID exists exactly once in the reconciliation workset.
3. L1 is resolved to the current Blueprint domain.
4. L2 is resolved from an authoritative, reconciled capability hierarchy.
5. L3 is resolved from the same hierarchy and is accountable for the capability.
6. L4 is resolved from the same hierarchy and is the execution-level capability boundary.
7. No duplicate, conflict, legacy-only, or unresolved mapping remains.
8. The feature name matches the current Blueprint spelling unless an explicit reconciliation record documents the difference.
9. Admission state is either `MATCH` or explicitly reviewed `BLUEPRINT_ONLY_REVIEWED`.
10. No API, domain, persistence, permission, state-machine, event, queue, cache, or evidence mapping is silently inferred merely to satisfy the gate.

## Fail-closed rule

`null`, `UNKNOWN`, inferred, guessed, or legacy-only L2/L3/L4 values are blocking states.

The graph MUST remain `NOT_GREEN` until the hierarchy is authoritative and mechanically resolvable.

## Current blocking condition

The 449-feature inventory has been staged, but the current reconciliation baseline still contains unresolved L2/L3/L4 values. The previously used fourth-level matrix is referenced by historical governance documents, but it is not currently present as an authoritative current-branch hierarchy source. Therefore the correct action is to reconcile or explicitly restore the hierarchy source before graph admission.

## Prohibited shortcuts

- Do not assign L2/L3/L4 by feature-name similarity.
- Do not manufacture hierarchy solely from API route names.
- Do not use Payload collection names as the canonical hierarchy.
- Do not import the historical matrix wholesale without ownership/conflict review.
- Do not set `GREEN` to bypass missing evidence.
- Do not begin API/DB mapping as a substitute for hierarchy resolution.

## Next execution gate

1. Recover/locate the authoritative L1-L4 hierarchy source.
2. Compare it against all 449 Blueprint Feature IDs.
3. Produce `MATCH / BLUEPRINT_ONLY / LEGACY_ONLY / CONFLICT / DUPLICATE / UNRESOLVED` results.
4. Resolve only evidence-backed L2/L3/L4 mappings.
5. Re-run the reconciliation checker.
6. Admit only resolved records into the formal Capability Graph.
7. Only after graph admission is green, resume API → Domain → DB projection.
