# CC-MAPPING-0-PRIV-004-ADMISSION-GUARD-2026-09-27

## Status

`GOVERNANCE_GUARD_ADDED / POLICY_INSTANCE_UNCHANGED / PROVENANCE_RECONCILED`

## Scope

Add a repository-local, fail-closed admission guard for the existing PRIV-004 policy-instance gate.

This change is directly dependent on:

- `contracts/privacy/PRIV-004-retention-policy-authority.v1.json`
- `artifacts/mapping-0/priv004-policy-instance-admission-packet-2026-09-27.json`
- `docs/change-control/CC-MAPPING-0-PRIV-004-POLICY-INSTANCE-ADMISSION-2026-09-27.md`

## Control

Canonical future input path:

`artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json`

The guard has two allowed states:

1. The concrete input file is absent.
   - The guard passes only to confirm the repository remains fail-closed.
   - The packet must remain `INPUT_REQUIRED`.
   - No policy instance is admitted.
   - No runtime authorization is created.

2. The concrete input file is present.
   - The instance must satisfy the existing PRIV-004 contract shape and the admission packet requirements.
   - The packet must already be reconciled to an admitted state before the input can be treated as usable.
   - Invalid, incomplete, or unadmitted input fails the guard.

## Validation boundary

The guard validates only structural/admission properties already required by the authoritative packet:

- non-empty policy identity/version/owner/environment/source authority/approval reference/rollback version;
- authoritative scope object;
- `APPROVED` or `ACTIVE` status;
- valid effective period;
- `LEGAL_AUDIT` retention class;
- exactly one deterministic rule mode;
- DURATION requires `durationSeconds` and forbids `fixedUntil`;
- FIXED_UNTIL requires `fixedUntil` and forbids `durationSeconds`;
- repository commit provenance contains an exact 40-hex commit SHA and canonical source path;
- the provenance commit is the commit that last changed the canonical policy-instance artifact;
- the provenance commit is an ancestor of the checked-out current HEAD;
- packet admission must not remain `INPUT_REQUIRED` when a concrete approved instance is present.

The provenance check intentionally does **not** require the policy-instance artifact to contain the self-referential SHA of the commit that contains that same artifact. See `CC-MAPPING-0-PRIV-004-PROVENANCE-RECONCILIATION-2026-09-27.md`.

The guard does not:

- choose a retention duration;
- choose a fixed-until date;
- infer a jurisdiction-specific legal requirement;
- determine business approval;
- mutate W01/W02/D1;
- implement runtime retention evaluation;
- promote Evidence Registry or Mapping 0 GREEN.

## Runtime boundary

AUTH-001 remains blocked by the existing PRIV-004 instance gate until a real approved policy instance is supplied and separately admitted through the existing change-control path.

This guard is a control-plane safety mechanism only.
