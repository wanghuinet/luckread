# CC-MAPPING-0-CONTRACT-CI-DEVELOPMENT-ADMISSION-MODE-2026-09-27

## Status

`APPROVED_RECONCILIATION / DEVELOPMENT_ADMISSION_SEPARATED_FROM_FULL_AUDIT`

## Finding

The repository already has two distinct governance layers:

1. Contract and structural admission required to develop a specifically admitted implementation slice.
2. Complete Five-Way / R4 / Evidence / R5 GREEN, which requires implementation and current executable evidence across the canonical feature set.

The existing Contract CI workflow executed both layers as one blocking workflow. That caused a repository-wide `NOT_GREEN` implementation/evidence state for 449 canonical features to block changes that only modified an already-reconciled control-plane gate.

This conflicts with the established Mapping 0 stage-separation decision and with later feature-specific implementation admissions such as AUTH-003, which explicitly admit a small implementation slice without promoting Mapping 0 or all Features to GREEN.

## Current authority

The following existing controls remain unchanged:

- `docs/change-control/CC-MAPPING-0-STAGE-SEPARATION-2026-09-18.md`
- `docs/change-control/CC-MAPPING-0-CONTRACT-CI-STAGE-COMPOSITION-2026-09-19.md`
- feature-specific implementation admission records
- strict R4 / Evidence Registry / R5 validators

No validator is weakened and no `continue-on-error` is added to a strict validator.

## Reconciled CI modes

`Contract CI` now has an explicit admission mode:

- `DEVELOPMENT` — used automatically for push and pull-request events. It validates the contract domains, semantic checks, feature inventory, Payload reconciliation, capability/entity/field structural checks, Mapping 0 structural verification, the full Contract domain validator, and OpenAPI lint.
- `FULL` — selected explicitly through `workflow_dispatch`. It additionally runs Five-Way Alignment and the strict R4/Evidence/R5 downstream gate.

The default mode is therefore appropriate for incremental Contract-First implementation while preserving the strict audit as an explicit gate.

## Non-authorizations

This change does not:

- promote Mapping 0 from `NOT_GREEN` to `GREEN`;
- promote any Feature, Entity, Credential or Identity to GREEN;
- create evidence records;
- rerun existing PASS_VERIFIED runtime evidence;
- authorize AUTH-001 runtime;
- supply a PRIV-004 retention duration or fixed-until value;
- relax the strict validators;
- introduce a Worker, D1, Queue, RPC or Payload Core change.

## FULL audit

The strict downstream validators remain fail-closed and are still authoritative for complete GREEN admission. They are available through the Contract CI workflow's manual `FULL` mode with an optional exact `checkout_ref`.

Manual workflow:

https://github.com/wanghuinet/luckread/actions/workflows/contract-ci.yml

## Expected outcome

PR/push Contract CI failure should now represent a real development-admission defect rather than the expected absence of implementation/evidence for unrelated future Blueprint features.

FULL mode remains the mechanism for proving whole-repository Five-Way / R4 / Evidence / R5 GREEN when the project has actually reached that stage.

## Current project cursor

The current Mapping 0 execution cursor remains unchanged:

`AUTH-001-REGISTRATION-CLOSURE / BLOCKED_PRIV004_POLICY_INSTANCE`

The next business gate remains admission of a real approved PRIV-004 policy instance. This CI reconciliation does not bypass that gate.
