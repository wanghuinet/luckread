# CC-MAPPING-0-PRIV-004-CURRENT-COMMIT-PROVENANCE-2026-09-27

## Status

`GUARD_TIGHTENED / POLICY_INSTANCE_UNCHANGED`

## Change

Tighten the existing PRIV-004 admission guard so a future concrete policy instance cannot pass admission using an arbitrary historical commit SHA.

The guard now requires:

- `provenance.commitSha == git rev-parse HEAD`;
- `provenance.sourcePath` equals the canonical approved-instance artifact path.

## Boundary

This is a mechanical provenance check against requirements already present in the PRIV-004 admission packet and governance baseline.

It does not:

- approve any policy;
- choose a retention duration;
- choose FIXED_UNTIL;
- infer a jurisdiction-specific rule;
- authorize AUTH-001 runtime;
- mutate Worker/D1 resources;
- promote Evidence Registry or Mapping 0 GREEN.

The concrete policy-instance input remains absent and therefore `INPUT_REQUIRED`.
