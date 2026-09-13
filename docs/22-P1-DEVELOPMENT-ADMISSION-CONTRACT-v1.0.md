# LuckRead Development Admission Contract v1.0

**Status:** APPROVED-CONTRACT-DESIGN / implementation gate specification  
**Scope:** Payload-based self-media platform  
**Rule:** Contract First, Code Next

## 1. Purpose

This contract defines the final admission gate between machine-readable contract completion and implementation work. No Payload customization, API implementation, migration, worker integration, or production feature code may be admitted merely because documentation exists.

The admission decision MUST be reproducible from repository state and verifiable CI evidence.

## 2. Admission States

```text
BLOCKED -> READY_FOR_DEVELOPMENT -> DEVELOPMENT_ADMITTED -> BLOCKED
```

- `BLOCKED`: implementation MUST NOT start or continue for the affected scope.
- `READY_FOR_DEVELOPMENT`: all required contracts and evidence are present and structurally valid.
- `DEVELOPMENT_ADMITTED`: CI has verified the exact commit and all mandatory gates pass.
- Any contract, dependency, validator, evidence, security invariant, or required CI gate becoming invalid returns the affected scope to `BLOCKED`.

## 3. Mandatory Admission Gates

All gates are mandatory; there is no manual override in normal development flow.

### G1 Contract Registry

Every implementation scope MUST map to a registered contract with:

- contractId
- version
- status
- owner
- source
- machine-readable artifact
- dependencies
- required evidence
- implementation scope

Unregistered contracts are not implementation authority.

### G2 Machine-readable Completeness

Every P0 contract required by the implementation scope MUST have a machine-readable artifact. The artifact MUST be parseable and validated by the repository validator.

### G3 Dependency Integrity

The contract dependency graph MUST have:

- no unresolved dependency;
- no dependency cycle;
- no dependency on RETIRED contracts;
- no dependency on an unapproved contract;
- no implementation dependency that bypasses the contract graph.

### G4 Validator Execution

Every required validator MUST actually execute on the candidate commit.

A validator that is skipped, cancelled, timed out before execution, unavailable, or lacks trustworthy execution evidence MUST NOT be interpreted as PASS.

### G5 Exact-Commit Evidence

Evidence MUST bind to the exact Git commit being admitted. Evidence from another commit, branch, artifact version, or stale run MUST NOT satisfy the gate unless an explicit immutable compatibility rule proves equivalence.

### G6 Full CI Green

All mandatory contract domains MUST PASS, including applicable:

- Common Schema
- Enums
- State Machines
- Authorization
- OpenAPI
- cross-contract validation
- OpenAPI lint
- registry/evidence validation

A partial matrix pass is not a full admission.

### G7 Security Invariants

The following MUST remain enforced:

- fail-closed authorization;
- account-state enforcement;
- ownership/rights scope enforcement;
- current principal-version checks;
- sensitive-operation MFA requirements;
- idempotency for mandatory high-risk operations;
- lifecycle/deletion enforcement;
- privacy/consent boundaries;
- dependency timeout/retry safety;
- auditability of privileged operations.

A test or validator MUST NOT be weakened to obtain admission.

### G8 API Contract Completeness

The API surface required by the implementation scope MUST exist in the machine-readable OpenAPI contract. Each endpoint MUST have sufficient request, response, error, authentication, authorization, pagination/cursor, and state semantics for implementation.

An API endpoint that exists only in prose is not implementation-ready.

### G9 State-Machine Completeness

Every stateful resource in the admitted scope MUST have an explicit state machine or an explicit declaration that no state machine is required.

Transitions MUST define:

- from;
- to;
- actor/authority;
- authorization requirements;
- optimistic/version protection where required;
- forbidden transitions;
- audit requirements.

### G10 Operational Safety

The admitted implementation scope MUST have defined behavior for:

- timeout;
- retry;
- duplicate request;
- unknown outcome;
- dependency failure;
- degraded mode;
- recovery;
- reconciliation;
- observability;
- data lifecycle.

No feature may rely on undefined failure behavior.

## 4. Admission Decision Algorithm

The decision MUST be logically equivalent to:

```text
ADMIT(scope, commit) =
  RegistryValid(scope)
  AND MachineReadableComplete(scope)
  AND DependencyGraphValid(scope)
  AND RequiredValidatorsExecuted(scope, commit)
  AND ExactCommitEvidenceValid(scope, commit)
  AND AllMandatoryChecksPASS(scope, commit)
  AND SecurityInvariantsPASS(scope, commit)
  AND APIContractComplete(scope)
  AND StateMachinesComplete(scope)
  AND OperationalSafetyComplete(scope)
```

If any operand is false, unknown, missing, stale, or unverifiable:

```text
ADMISSION = BLOCKED
```

There is no `UNKNOWN => PASS` behavior.

## 5. Evidence Rules

Evidence is valid only when all of the following hold:

1. Evidence has a unique evidenceId.
2. It identifies contractId and contract version.
3. It identifies the exact artifact/path validated.
4. It identifies validator name and validator version.
5. It identifies the exact commit SHA.
6. It identifies the workflow/run/job that executed the validator.
7. It has an execution timestamp.
8. Its result is explicitly `PASS`.
9. The execution actually occurred.
10. Required dependencies were themselves valid.
11. Evidence has not expired or been invalidated by a relevant contract change.

The Evidence Registry MUST NOT be considered valid merely because a file exists or contains a textual PASS value.

## 6. Change Invalidation

A relevant change MUST invalidate affected admission evidence, including changes to:

- machine-readable contract artifacts;
- registry records;
- validator implementation;
- CI workflow;
- dependency contracts;
- OpenAPI schemas;
- authorization rules;
- state machines;
- lifecycle/privacy/security invariants.

After invalidation, the affected scope returns to `BLOCKED` until new evidence is generated for the candidate commit.

## 7. Scope-Based Admission

Admission is scoped. Passing one domain does not admit unrelated domains.

Example:

```text
Auth/User PASS
Content BLOCKED

=> Auth/User implementation may be admitted only if its dependency closure is also PASS.
=> Content implementation remains BLOCKED.
```

Cross-domain dependencies expand the required admission closure automatically.

## 8. Payload Development Boundary

Once admitted, implementation MUST preserve the contract boundary:

```text
Contract
  ↓
Payload configuration / extension
  ↓
Application service
  ↓
API / Worker integration
  ↓
Persistence / R2 / D1
```

Payload is the CMS foundation; implementation MUST NOT silently redefine contract semantics inside Payload hooks, access rules, collections, routes, or application code.

If implementation discovers a contract defect, development MUST stop for the affected scope and return to Contract Review rather than introducing an undocumented behavior.

## 9. Mandatory Development Stop Conditions

Development MUST immediately return to `BLOCKED` when any of the following occurs:

- contract ambiguity affects behavior;
- API behavior is not represented by the contract;
- authorization cannot be decided deterministically;
- ownership/right scope is ambiguous;
- state transition is undefined;
- duplicate/unknown-outcome behavior is undefined;
- dependency failure behavior is undefined;
- required evidence is stale or missing;
- CI does not execute a mandatory validator;
- security invariant is weakened;
- migration changes contract semantics without contract review;
- implementation requires an undocumented exception.

## 10. Anti-Gaming Rules

The following are prohibited:

- deleting a failing validator instead of fixing the contract;
- narrowing validation scope solely to avoid a failure;
- converting a required check to warning-only;
- treating skipped jobs as PASS;
- reusing evidence from an unrelated commit;
- manually editing generated evidence to PASS;
- hiding contract failures behind conditional CI branches;
- removing an API/state/security requirement because implementation is inconvenient;
- marking a contract APPROVED before required evidence exists.

## 11. Required Machine-readable Admission Record

The admission system SHOULD emit a machine-readable record with at least:

```json
{
  "admissionId": "...",
  "scope": "...",
  "commitSha": "...",
  "decision": "BLOCKED|READY_FOR_DEVELOPMENT|DEVELOPMENT_ADMITTED",
  "contracts": [],
  "dependencies": [],
  "validators": [],
  "evidence": [],
  "failedGates": [],
  "generatedAt": "..."
}
```

The record is evidence of the decision, not a substitute for the underlying validator execution.

## 12. Development Admission Checklist

Before implementation begins:

- [ ] Contract Registry valid.
- [ ] P0 dependency closure resolved.
- [ ] Machine-readable artifacts present.
- [ ] Common schemas pass.
- [ ] Enums pass.
- [ ] State machines pass.
- [ ] Authorization passes.
- [ ] OpenAPI passes.
- [ ] OpenAPI lint passes.
- [ ] Cross-contract invariants pass.
- [ ] Evidence is non-empty and exact-commit bound.
- [ ] All mandatory validators actually executed.
- [ ] No stale/unverified evidence exists in the admission path.
- [ ] Security invariants pass.
- [ ] API completeness passes.
- [ ] Operational failure/recovery behavior is defined.

Only after every applicable item is checked may the scope enter `DEVELOPMENT_ADMITTED`.

## 13. Relationship to Contract CI

Contract CI is necessary but not sufficient. CI proves that validators executed and passed; Development Admission proves that the complete contract dependency closure has trustworthy evidence and is therefore eligible for implementation.

```text
Contract CI GREEN
        ↓
Evidence valid
        ↓
Dependency closure valid
        ↓
Admission GREEN
        ↓
Development allowed
```

If GitHub Actions has an execution-layer outage and validators never execute, the result is **not GREEN** and is **not an admission**. The system remains blocked until trustworthy execution evidence exists.

## 14. Versioning

This contract is v1.0. Any change to admission semantics, fail-closed rules, evidence validity, required gates, or anti-gaming rules requires a new contract review/version.
