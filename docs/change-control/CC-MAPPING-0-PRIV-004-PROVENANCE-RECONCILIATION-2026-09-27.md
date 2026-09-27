# CC-MAPPING-0-PRIV-004-PROVENANCE-RECONCILIATION-2026-09-27

## Status

`APPROVED_RECONCILIATION / GUARD_SELF_REFERENCE_FIXED`

## Finding

The original PRIV-004 admission guard required:

`instance.provenance.commitSha === git rev-parse HEAD`

for the canonical approved policy-instance artifact.

That condition is not realizable through an ordinary Git commit because the commit SHA is derived from the commit tree, while the tree contains the policy-instance artifact whose contents would need to contain that same commit SHA. The condition therefore creates a self-referential provenance deadlock.

## Contract reconciliation

The authoritative PRIV-004 contract requires **current-commit provenance**, meaning the admitted policy instance must have repository provenance that is traceable in the current main history. The contract does not authorize a self-referential commit hash.

The reconciled interpretation is:

1. `provenance.commitSha` identifies an approval/source checkpoint commit that predates the canonical policy-instance artifact change.
2. The guard resolves the canonical policy-instance source commit from Git history.
3. The guard requires `provenance.commitSha` to be an ancestor of that artifact source commit and of the checked-out current HEAD.
4. This proves the policy instance is attached to an already-existing repository authorization checkpoint without requiring an impossible self-reference.
5. The canonical `provenance.sourcePath` remains fixed to:
   `artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json`

## Scope

This change only repairs the PRIV-004 control-plane provenance check.

It does not:

- create or invent a policy instance;
- select a retention duration;
- select a fixed-until timestamp;
- infer a jurisdiction-specific legal rule;
- authorize AUTH-001 runtime;
- change W01/W02/D1 architecture;
- change Payload Core;
- promote Evidence Registry or Mapping 0 GREEN.

## Current blocker remains unchanged

The canonical approved policy-instance artifact is still absent on main.

Therefore the repository remains:

`PRIV-004 INPUT_REQUIRED -> AUTH-001 RUNTIME BLOCKED`

The repair only ensures that a future authoritative approved instance can be admitted through a mechanically realizable provenance rule. The provenance checkpoint is traceability evidence; it is not itself a legal/compliance authority.

## Required verification

The resulting branch must pass the existing PRIV-004 admission workflow and applicable Contract CI checks. No runtime evidence rerun is required by this reconciliation.
