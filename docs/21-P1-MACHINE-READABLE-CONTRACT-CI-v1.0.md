# P1 Machine-Readable Contract CI v1.0

## 1. Purpose

This contract defines the mandatory CI behavior that converts approved platform contracts into an executable development admission gate.

Contract CI MUST validate machine-readable artifacts, cross-contract invariants, registry dependencies, and evidence integrity. Documentation alone MUST NOT authorize implementation.

## 2. Admission Principle

The default result is `BLOCKED`.

CI may produce `GREEN` only when every required gate for the candidate commit has actually executed and passed.

A missing, skipped, cancelled, stale, unverifiable, or non-executed required gate MUST NOT be interpreted as PASS.

## 3. Required Validation Layers

Contract CI MUST support these layers as they become available:

1. schema syntax and structural validation;
2. reference resolution;
3. enum validation;
4. state-machine validation;
5. authorization invariant validation;
6. privacy/lifecycle/idempotency/event invariants;
7. OpenAPI validation;
8. Contract Registry validation;
9. Evidence DAG validation;
10. cross-contract invariant validation;
11. implementation admission decision.

A later layer MUST NOT silently compensate for a failed earlier layer.

## 4. Machine-Readable Inputs

CI MUST validate machine-readable contracts from repository state, including where applicable:

- JSON Schema;
- OpenAPI;
- enums;
- state-machine definitions;
- authorization policies;
- Contract Registry;
- evidence metadata;
- invariant definitions.

The validator MUST use the checked-out candidate commit as its source of truth.

## 5. Deterministic Validation

Validation SHOULD be deterministic for the same repository commit, validator version, and declared environment.

Network-dependent validation MUST NOT silently downgrade to success when a dependency is unavailable.

If an external validator cannot execute, the affected gate MUST be `UNVERIFIED` or `BLOCKED`, according to gate criticality.

## 6. Fail-Closed Rules

CI MUST fail closed for:

- missing required artifact;
- malformed machine-readable contract;
- unresolved reference;
- duplicate contract identity;
- contradictory cross-contract invariant;
- missing required domain coverage;
- missing registry entry;
- missing evidence;
- evidence bound to another commit;
- validator not executed;
- required gate skipped/cancelled;
- stale evidence;
- unsupported contract version;
- unknown required status.

## 7. Evidence Production

Every mandatory validation gate MUST produce machine-readable evidence containing at minimum:

- gateId;
- contract/artifact identity;
- commit SHA;
- validator identity/version;
- execution timestamp;
- result;
- failure diagnostics when applicable.

Evidence MUST be generated from actual execution rather than manually committed PASS markers.

## 8. Evidence Freshness

Evidence for a previous commit MUST NOT satisfy a gate for a changed candidate commit unless the registry explicitly proves the validated artifact is unchanged and the reuse rule is allowed.

Changes to a contract, schema, registry, validator, workflow, or relevant dependency MUST trigger appropriate revalidation.

## 9. Gate Status Vocabulary

The canonical gate result vocabulary is:

`PASS`, `FAIL`, `SKIPPED`, `CANCELLED`, `UNVERIFIED`, `STALE`, `MISSING`.

Only `PASS` satisfies a mandatory gate.

## 10. Domain Matrix

CI SHOULD expose separate gates for independent domains to improve diagnosis, but the final admission decision MUST require all mandatory gates.

The domain matrix MUST NOT weaken full validation: the aggregate/full gate remains authoritative.

## 11. Cross-Contract Validation

CI MUST validate declared dependencies and invariants across domains.

At minimum it MUST be able to detect incompatible relationships involving:

- Common ↔ OpenAPI;
- Authorization ↔ Account State;
- Authorization ↔ Ownership/Rights;
- Privacy ↔ Authorization;
- Lifecycle ↔ Cache/derived data;
- Idempotency ↔ Events;
- Dependency Reliability ↔ Idempotency;
- Observability ↔ Privacy;
- API ↔ Error/Pagination/Cursor schemas.

## 12. OpenAPI Admission

OpenAPI linting is mandatory for the API contract.

A contract containing no API paths MUST NOT pass API admission when API implementation is in scope.

OpenAPI schemas MUST remain consistent with canonical common schemas and declared domain contracts.

## 13. Registry Admission

The Contract Registry MUST be validated before development admission.

Every implementation domain in production scope MUST have governing contract coverage.

An unregistered implementation surface MUST be reported as an admission failure unless explicitly marked experimental/non-production.

## 14. Evidence DAG Admission

The Evidence DAG MUST prove the chain:

`Contract -> Artifact -> Validator -> CI Execution -> Evidence -> Admission`

An empty Evidence Registry, absent execution record, or unverifiable workflow result MUST result in `BLOCKED`.

A green workflow status alone is insufficient evidence when mandatory validator steps did not execute.

## 15. Workflow Integrity

The CI workflow itself is a governed artifact.

Changes to the validator or workflow MUST trigger contract validation.

The workflow MUST NOT contain conditions that allow required gates to be skipped while still producing a successful admission decision.

Required jobs SHOULD use explicit dependencies so the aggregate admission gate cannot run before required gates complete.

## 16. Local and CI Parity

Local validation and GitHub Actions validation SHOULD invoke the same canonical validator and contract set.

Differences in runtime, validator version, or validation scope MUST be explicit and observable.

A local PASS MUST NOT override a CI failure.

## 17. Pull Request Protection

When repository branch protection supports required checks, the final Contract Admission Gate SHOULD be configured as a required status check before production implementation merges.

A successful documentation-only change MUST NOT be used to bypass required contract gates for implementation changes.

## 18. Change Impact

CI MUST determine whether changed files affect contract admission.

At minimum, changes under these areas MUST trigger appropriate contract validation:

- `contracts/**`;
- `docs/*-CONTRACT-*`;
- `scripts/contract-ci.mjs`;
- Contract Registry/evidence files;
- `.github/workflows/contract-ci.yml`.

The exact path mapping MUST be maintained as the registry grows.

## 19. Reporting

CI output MUST clearly distinguish:

- PASS;
- FAIL;
- BLOCKED;
- UNVERIFIED;
- SKIPPED.

The final report MUST identify the candidate commit and the gates that actually executed.

A generic `GREEN` message without gate-level evidence is insufficient for development admission.

## 20. Anti-Gaming Controls

The validator MUST NOT be weakened solely to make the current repository pass.

Adding an exception requires a contract-level rationale and explicit review.

Removing a required gate requires updating the governing contract and registry before the gate is removed.

Manually asserting a PASS without execution evidence is forbidden.

## 21. Acceptance Criteria

- [ ] CI validates machine-readable contract artifacts.
- [ ] CI validates the Contract Registry.
- [ ] CI validates Evidence DAG requirements.
- [ ] Missing evidence blocks admission.
- [ ] Unexecuted validators cannot satisfy gates.
- [ ] Stale evidence cannot satisfy current commit admission.
- [ ] Cross-contract invariants are validated.
- [ ] OpenAPI is linted and structurally validated.
- [ ] Required gates have explicit status vocabulary.
- [ ] Aggregate admission requires all mandatory gates.
- [ ] Workflow/validator changes trigger validation.
- [ ] Local and CI validator semantics remain aligned.
- [ ] Implementation surfaces without governing contracts are blocked.
- [ ] CI reports actual execution evidence.
- [ ] Anti-gaming controls are enforced.
