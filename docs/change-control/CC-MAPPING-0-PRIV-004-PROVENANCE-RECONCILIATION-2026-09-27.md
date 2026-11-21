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

The **development/test** canonical policy-instance artifact is now present on `main` as `DEV-2026-09-28.1`.

The **production** approved/active PRIV-004 policy instance is still absent. Production therefore remains fail-closed.

Therefore the repository remains:

`PRIV-004 PRODUCTION_INPUT_REQUIRED -> AUTH-001 PRODUCTION_RUNTIME_BLOCKED`

The provenance repair ensures that a future production-authoritative policy instance can be admitted through a mechanically realizable provenance rule. The existing development instance remains limited to controlled engineering validation. The provenance checkpoint is traceability evidence; it is not itself a legal/compliance authority.

## Current-main development approval checkpoint — 2026-09-28

The development-only `PRIV-004-ACCOUNT-REGISTRATION-DEV-TEMP / DEV-2026-09-28.1` engineering test policy is approved for development/integration validation only. This paragraph is the current-main approval/source checkpoint for the canonical policy-instance artifact. Production legal/compliance authority remains pending.

## Required verification

The resulting branch must pass the existing PRIV-004 admission workflow and applicable Contract CI checks. No runtime evidence rerun is required by this reconciliation.

## Checkpoint record

This non-empty governance commit is the preserved approval/source checkpoint for the development-only PRIV-004 policy artifact; the following artifact commit binds its provenance to this checkpoint.
