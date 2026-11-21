# Change Control — Mapping 0 / Contract CI Stage Composition Gap

- ID: CC-MAPPING-0-CONTRACT-CI-STAGE-COMPOSITION-2026-09-19
- Date: 2026-09-19
- Scope: CI gate composition only
- Status: CLOSED / DECISION EXECUTED

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

## Decision

The existing stage-separation authority is adopted as the explicit resolution for this CI composition gap:

1. The `capability-graph` job remains the structural capability/entity/field validation stage and does not own strict R4/Evidence/R5 admission.
2. R4 (`feature-entity-persistence-registry-check.mjs`), final Evidence Registry validation, R4 gap reporting and R5 validation move to a dedicated `capability-graph-strict-downstream` job.
3. `contract-full` depends on both capability stages, so overall Contract CI remains fail-closed on strict downstream checks.
4. `mapping-zero-final` remains independently executable and authoritative for the Mapping 0 structural/contract stage.

This is a gate-composition change only. No business implementation, D1 migration, API/DTO/entity creation, evidence-date manipulation, or Feature status promotion is authorized.

## Verification invariant

- Strict R4 validator is unchanged.
- Strict Evidence Registry validator is unchanged.
- R5 validator is unchanged.
- No strict validator is marked `continue-on-error`.
- Mapping 0 structural gate remains independent from strict downstream admission.

## Disposition

CLOSED — decision executed in `.github/workflows/contract-ci.yml`. The change preserves fail-closed downstream validation while removing the stage-composition ambiguity. Historical finding and boundary remain recorded; reopen only if stage authority changes.
