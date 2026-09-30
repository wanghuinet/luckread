# B13 — Persistence Closure Gate v1.0

## Status
IN PROGRESS / NOT GREEN

## Purpose
Establish the next fail-closed gate after B12 without inventing database schema, migration artifacts, or runtime evidence.

## Rule
Mapping remains non-GREEN until every admitted persistence entity has an authoritative chain:

`Entity → Field → Payload/Contract source → Migration → D1 table/column → constraints → execution evidence → validator evidence`

## Current dependency
B12 — ENT-USER Persistence Reconciliation remains `BLOCKED / NOT GREEN` because current-main repository evidence does not yet prove a concrete migration artifact and execution result for the six canonical ENT-USER fields.

## Work permitted before GREEN

- inspect existing contracts, Payload collections, adapter configuration, and repository evidence;
- identify missing evidence and reconciliation gaps;
- prepare deterministic validation/checklists;
- prepare W01 configuration boundaries without duplicating or replacing the root Payload runtime;
- preserve the locked 12-worker / 4-D1 architecture;
- keep Payload in W01, Content in W02, and Media in W06;
- reconcile documentation and contracts when new authoritative evidence exists.

## Work prohibited before GREEN

- implementing business features;
- fabricating D1 table/column names or migration versions;
- marking persistence entities VERIFIED solely from TypeScript collection definitions;
- replacing Payload-native persistence with parallel custom persistence without an approved change-control record;
- moving the root Payload runtime into W01 before mapping closure;
- adding R2 adapter behavior merely to satisfy an apparent implementation gap;
- declaring Mapping 0 GREEN from documentation-only evidence.

## GREEN criteria

B13 can advance only after B12 has authoritative migration/schema evidence. Final Mapping 0 GREEN additionally requires all admitted mapping batches to have reconciled source, contract, implementation boundary, and evidence state, with no unresolved blocking GAP.

## Development gate

No feature development starts before Mapping 0 is GREEN. Once GREEN, the sequence is:

`Mapping GREEN → Contract reconciliation → implementation plan → W01/base runtime reconciliation → worker implementation → CI/evidence`

## Architecture lock

This gate does not alter the locked architecture:

- W01 — Platform / Payload Core
- W02 — Content
- W03 — Feed
- W04 — Social
- W05 — Transaction
- W06 — Media
- W07 — Async / Event
- W08 — Search
- W09 — Index / Recommendation
- W10 — Market / IP
- W11 — Analytics / Ads
- W12 — Open / Extension

D1-Fabric is out of scope for this repository.
