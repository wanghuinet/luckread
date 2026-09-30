# Change Control — Mapping 0 Stage Separation

- ID: CC-MAPPING-0-STAGE-SEPARATION-2026-09-18
- Date: 2026-09-18
- Scope: Mapping 0 only
- Decision: Separate Mapping 0 structural/contract mapping closure from later implementation/runtime evidence closure.

## Problem

The existing Mapping 0 aggregate invokes gates that require runtime implementation evidence for every canonical Feature. In particular, the final Evidence Registry gate requires current executable PASS evidence, and the R4 checker requires every Feature to be `VERIFIED`. That makes Mapping 0 depend on business implementation that is explicitly outside the Mapping 0 stage.

The repository already distinguishes `MAPPED` and `VERIFIED` in the Feature-Entity-Persistence schema, while current implementation evidence is intentionally incomplete. Treating all Features as `VERIFIED` before implementation would manufacture evidence and violate Contract-First governance.

## Stage rule

Mapping 0 GREEN means:

1. Canonical Feature Inventory is complete and each canonical Feature has exactly one canonical mapping record.
2. No duplicate or orphan Feature IDs remain in canonical mapping batches.
3. Mapping records have the required structural mapping fields and explicit unresolved downstream gaps where applicable.
4. Entity catalog and entity-field contract/schema checks are structurally valid.
5. Implementation/runtime/test evidence is **not** promoted to VERIFIED merely to satisfy Mapping 0.

Later Contract/Reconciliation/Evidence/Gate stages remain responsible for executable implementation evidence, persistence verification, runtime evidence, and final feature-level verification.

## Non-goals

- No Article/Video/Feed/Comment/Like/Follow/Subscription business implementation.
- No new business database tables or migrations.
- No D1-Fabric architecture or code.
- No conversion of `UNRESOLVED`/`PARTIAL` mapping records into false implementation claims.

## Reconciliation requirement

The Mapping 0 verifier must use a stage-appropriate structural mapping gate. The stricter executable-evidence validators remain available for the later evidence gate and are not weakened.

This change is limited to gate composition and stage semantics; it does not assert that the product is implemented.
