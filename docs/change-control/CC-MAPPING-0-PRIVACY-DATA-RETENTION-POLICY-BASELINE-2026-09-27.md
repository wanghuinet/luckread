# CC-MAPPING-0-PRIVACY-DATA-RETENTION-POLICY-BASELINE-2026-09-27

## Status

`GOVERNANCE_BASELINE_ADMITTED / PRIV-004-INSTANCE-UNCHANGED`

## Change

Add:

`docs/176-PRIVACY-DATA-RETENTION-POLICY-v0.1.md`

as the initial LuckRead privacy/data-retention governance baseline.

## Decision

The new policy establishes:

- data minimization and purpose limitation;
- retention classes;
- server-controlled retention resolution;
- policy versioning and provenance;
- deletion / erasure lifecycle expectations;
- legal hold semantics;
- derived data, media and backup interaction;
- third-party data-flow review requirements;
- pre-launch review requirements.

## Explicit boundary

This change **does not** admit a concrete PRIV-004 policy instance.

It intentionally does not select:

- a consent retention duration;
- a fixed-until date;
- a jurisdiction-specific legal retention rule;
- a public final privacy notice.

The policy therefore does not unblock AUTH-001 runtime implementation.

## Relationship to existing authority

The baseline is constrained by:

- `docs/160-DATA-LIFECYCLE-RETENTION-ERASURE-CONTRACT-v1.0.md`;
- `docs/175-FEATURE-FLAG-CONFIG-POLICY-VERSIONING-CONTRACT-v1.0.md`;
- `contracts/privacy/PRIV-004-retention-policy-authority.v1.json`;
- `contracts/entity/PRIV-002-consent-field-contract.v1.json`;
- the current AUTH-001 / PRIV-004 change-control records.

No existing valid contract or evidence artifact is replaced.

## Pre-launch evolution

Before APP/website public launch, the policy must be reviewed against the actual product data inventory, user regions, external processors, analytics/advertising/payment integrations, and concrete retention requirements. A later version may supersede v0.1 through normal policy versioning.

## Evidence boundary

Documentation admission is not runtime evidence.

No Evidence Registry promotion, AUTH-001 GREEN, or Mapping 0 GREEN is claimed by this change.
