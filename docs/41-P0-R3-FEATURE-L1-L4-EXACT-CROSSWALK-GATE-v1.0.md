# Luckread P0 — R3 Feature → L1/L2/L3/L4 Exact Crosswalk Gate v1.0

**Status:** IMPLEMENTED / FAIL-CLOSED / NOT YET ADMITTED

## Objective

Turn the active Blueprint 2.0 Feature inventory into a deterministic historical L1-L4 crosswalk without fabricating hierarchy.

## Source of truth

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` is authoritative for Feature identity and feature completeness. Historical L1-L4 matrices are recovery evidence only.

## Algorithm

1. Parse every Blueprint Feature ID and its explicit current L1 domain.
2. Parse the recovered historical L4 nodes.
3. Normalize only punctuation, slash separators, dash variants, quotes and whitespace.
4. Permit `MATCH` only when exactly one historical L4 has the same normalized feature name.
5. Permit no fuzzy/similarity/semantic/API/DB/Payload inference.
6. Multiple candidates become `DUPLICATE` and block admission.
7. No candidate becomes `UNRESOLVED` and blocks admission.
8. A match never makes the historical hierarchy authoritative.

## Admission rule

The generated crosswalk is `RECOVERY_CANDIDATE_ONLY` until all records are resolved without duplicates or unresolved mappings. The R3 gate is intentionally fail-closed.

## CI

`contract-ci.yml` executes the R3 gate before Capability Graph admission.

## Next stage

After R3 becomes admissible, populate the contract graph from the Blueprint using the resolved Feature IDs, beginning with Feature → Domain → Entity/Persistence ownership. No API, database, Worker, Event or Permission relationship is inferred merely from feature names.
