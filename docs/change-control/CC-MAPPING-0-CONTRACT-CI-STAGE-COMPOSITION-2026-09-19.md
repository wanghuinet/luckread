# Change Control — Mapping 0 / Contract CI Stage Composition Gap

- ID: CC-MAPPING-0-CONTRACT-CI-STAGE-COMPOSITION-2026-09-19
- Date: 2026-09-19
- Scope: CI gate composition only
- Status: OPEN / NO IMPLEMENTATION CHANGE

## Finding

The repository's Mapping 0 stage-separation control defines Mapping 0 GREEN as structural/contract mapping closure and explicitly keeps executable implementation/runtime/evidence promotion downstream.

The dedicated Mapping 0 verifier already follows that rule through:

- `scripts/mapping-0-structural-gate.mjs`
- entity catalog checks
- entity-field contract checks
- entity-field-schema checks

However, `.github/workflows/contract-ci.yml` still executes the stricter R4 Feature→Entity→Persistence registry check and the final executable Evidence Registry check inside the `capability-graph` job.

Those checks intentionally remain fail-closed while the repository is not technically closed. Their failure must not be interpreted as a failure of the structural Mapping 0 gate itself.

## Evidence

Current strict R4 checker:

`scripts/feature-entity-persistence-registry-check.mjs`

requires every Blueprint Feature to be explicitly present and `VERIFIED`.

Current final Evidence Registry checker:

`scripts/mapping-0-evidence-registry-final-check.mjs`

requires canonical Mapping GREEN plus current executable PASS evidence for every canonical Feature.

Current stage-separation authority:

`docs/change-control/CC-MAPPING-0-STAGE-SEPARATION-2026-09-18.md`

states that executable implementation/runtime/evidence admission is downstream from Mapping 0 structural closure.

## Disposition

This is a governance/tooling composition discrepancy, not a reason to weaken either strict downstream validator.

No workflow modification is made in this change-control record.

The strict validators remain authoritative for their downstream stages. The dedicated Mapping 0 structural verifier remains authoritative for the Mapping 0 structural handoff.

## Required future resolution

Before claiming overall Contract CI GREEN, reconcile workflow composition through an explicit change-control decision that preserves:

1. fail-closed strict R4 validation;
2. fail-closed executable Evidence Registry validation;
3. independent Mapping 0 structural GREEN semantics;
4. no status promotion by inference.

No business implementation, D1 migration, or evidence-date manipulation is part of this change control.
