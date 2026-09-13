# P1 Contract Registry and Evidence DAG v1.0

## 1. Purpose

This contract defines the authoritative registry and dependency graph for all machine-readable and human-readable platform contracts.

The registry exists to prevent undocumented behavior, orphan contracts, contradictory versions, incomplete domain coverage, and CI approval based on missing evidence.

## 2. Source of Truth

The repository contract registry is the authoritative index of contract identity, version, status, ownership, dependencies, machine-readable artifacts, validation rules, and evidence.

A document that is not registered MUST NOT be treated as an approved implementation contract.

Code MUST NOT silently redefine a registered contract.

## 3. Contract Identity

Every contract MUST have a stable identity containing at minimum:

- contractId;
- name;
- domain;
- version;
- lifecycle status;
- owner;
- source path;
- machine-readable representation when applicable.

Contract IDs MUST remain stable across non-breaking revisions. Breaking changes require a new major contract version or explicitly versioned replacement.

## 4. Lifecycle

A contract MUST progress through explicit states:

`DRAFT -> REVIEW -> VALIDATED -> APPROVED -> DEPRECATED -> RETIRED`

Only `APPROVED` contracts may authorize implementation admission.

`DRAFT` or `REVIEW` contracts may describe intended behavior but MUST NOT be treated as implementation authority.

A contract MUST NOT move directly to `APPROVED` without its required validation evidence.

## 5. Registry Record

Each registry entry SHOULD contain:

```yaml
contractId: CONTRACT-ID
name: Contract Name
domain: domain
version: 1.0
status: APPROVED
owner: team-or-owner
source: docs/path.md
machineReadable:
  - contracts/path
dependsOn:
  - OTHER-CONTRACT-ID
requiredEvidence:
  - schema-validation
  - contract-ci
  - compatibility-check
implementedBy:
  - code/path
```

The registry itself MUST be machine-readable so CI can validate it.

## 6. Dependency Graph

Contracts form a directed acyclic graph where an edge `A -> B` means A depends on B.

The graph MUST:

- contain no unresolved dependencies;
- contain no dependency cycles unless explicitly modeled as a permitted meta-level relation;
- identify transitive dependencies;
- prevent implementation admission when a required dependency is unapproved;
- detect references to retired or incompatible versions.

Core dependency direction SHOULD remain:

`Common -> Domain -> Cross-Domain -> API -> Implementation`

Implementation MUST depend on contracts, not redefine them.

## 7. Evidence DAG

Validation evidence is itself part of the admission chain.

A valid evidence graph MUST prove:

`Contract -> Machine-readable Artifact -> Validator -> CI Run -> Evidence Result -> Admission Decision`

Every approval MUST be traceable to a concrete evidence node.

An empty Evidence Registry MUST NEVER produce a PASS.

A validator MUST fail closed when required evidence is absent, stale, malformed, unrelated to the target contract, or produced by an untrusted/invalid validation path.

## 8. Evidence Identity

Each evidence record SHOULD identify:

- evidenceId;
- contractId/version;
- artifact/path;
- validator/version;
- commit SHA;
- workflow/run ID;
- execution timestamp;
- result;
- environment/runtime where relevant;
- dependencies validated;
- expiration/revalidation policy.

Evidence MUST be attributable to a specific repository state.

## 9. Evidence Freshness

Evidence MUST be bound to the commit or artifact state it validates.

A changed contract or machine-readable artifact MUST invalidate evidence that depended on the changed content unless dependency-aware validation proves it remains valid.

CI MUST NOT reuse stale PASS results after relevant contract changes.

## 10. Evidence Completeness

For every contract marked `APPROVED`, the registry MUST identify all mandatory validation gates.

A gate is satisfied only when its execution actually occurred and returned a valid PASS.

Skipped, cancelled, timed-out-before-execution, missing-log, or infrastructure-unverified jobs MUST NOT be interpreted as PASS.

A workflow that creates no validator execution evidence MUST NOT satisfy a contract gate.

## 11. Validator Rules

The registry validator MUST fail closed for:

- missing contract ID;
- duplicate contract identity/version;
- missing source path;
- missing required machine-readable artifact;
- unresolved dependency;
- dependency cycle;
- unapproved dependency;
- missing required evidence;
- stale evidence;
- evidence for a different commit/artifact;
- PASS without actual validator execution;
- invalid status transition.

Validation errors MUST use stable error codes.

## 12. Change Impact Analysis

A contract change MUST identify affected dependents through graph traversal.

At minimum CI SHOULD calculate:

- directly affected contracts;
- transitively affected contracts;
- affected machine-readable artifacts;
- affected API surfaces;
- affected implementation packages;
- required regression gates.

A contract change MUST NOT be considered isolated merely because its file is isolated.

## 13. Version Compatibility

The registry MUST record compatibility relationships between contract versions.

Non-breaking changes MAY remain within the same major version when all compatibility invariants hold.

Breaking changes MUST trigger explicit migration/versioning and invalidate incompatible implementation evidence.

Consumers MUST declare the contract version they implement or consume where version negotiation is relevant.

## 14. Domain Coverage

Every platform domain MUST map to one or more contracts.

At minimum the registry SHOULD cover:

- common schemas;
- authentication/identity;
- authorization/RBAC/scopes;
- account state;
- content;
- media;
- ownership/rights/IP;
- organization/MCN;
- privacy/consent;
- lifecycle/deletion;
- events;
- idempotency;
- observability;
- dependency reliability;
- API/OpenAPI;
- notifications;
- social interactions;
- monetization/rewards where implemented.

An implementation domain with no governing contract MUST be flagged as an admission failure or explicitly classified as experimental/non-production.

## 15. Cross-Contract Invariants

The registry MUST support explicit invariant declarations across contracts.

Examples:

- Authorization + Account State: banned/suspended states constrain authorization.
- Authorization + Ownership/Rights: rights are required for rights-sensitive actions.
- Privacy + Authorization: privileged roles do not bypass privacy purpose/scope.
- Lifecycle + Cache: deleted/restricted resources cannot be resurrected by stale cache.
- Idempotency + Events: one logical mutation cannot create duplicate authoritative effects.
- Dependency Reliability + Idempotency: retryable side effects use stable operation identity.
- Observability + Privacy: telemetry cannot become an undeclared data collection path.
- API + Common Schema: errors/pagination/cursors use canonical schemas.

## 16. API and Implementation Binding

Every production API operation MUST identify the contracts governing:

- authentication;
- authorization;
- request/response schema;
- error behavior;
- pagination/cursor behavior where applicable;
- state transitions;
- idempotency where applicable;
- lifecycle;
- privacy/data purpose;
- observability;
- dependency failure behavior.

Implementation PRs MUST NOT introduce an unregistered contract through code comments or implicit behavior.

## 17. Registry Change Control

Registry changes MUST themselves be validated.

Adding, removing, renaming, or changing a contract entry MUST trigger registry validation and impacted-contract validation.

Deleting a contract MUST require explicit replacement/deprecation semantics when active consumers exist.

## 18. CI Evidence Requirements

Contract CI MUST produce machine-readable evidence sufficient to determine:

- what was validated;
- against which commit;
- with which validator/version;
- which gates ran;
- which gates passed/failed;
- which dependencies were included;
- whether any required gate was skipped.

A green workflow badge alone is insufficient evidence when required validator jobs did not execute.

## 19. Development Admission

Development admission requires all applicable registry conditions to be satisfied:

1. governing contracts are registered;
2. required contracts are `APPROVED`;
3. machine-readable artifacts exist;
4. dependency graph is valid;
5. required cross-contract invariants pass;
6. validator actually executed;
7. required CI gates actually executed;
8. evidence is bound to the candidate commit;
9. no required gate is skipped/unverified;
10. implementation scope matches approved contracts.

If any condition is false, admission is `BLOCKED`.

## 20. Anti-Gaming Invariants

The system MUST NOT permit approval through:

- empty evidence registries;
- empty test suites;
- skipped required jobs;
- workflow success caused only by dependency/job conditions while validators did not execute;
- stale evidence copied from another commit;
- manually asserted PASS without execution evidence;
- weakening validators solely to accept incomplete contracts;
- removing a failing gate without updating the governing contract and approval record.

## 21. Machine-Readable Minimum Schema

The registry SHOULD expose machine-readable objects for:

- contracts;
- dependencies;
- invariants;
- evidence records;
- validation gates;
- compatibility/version rules;
- admission decisions.

Required status vocabulary SHOULD include:

`DRAFT`, `REVIEW`, `VALIDATED`, `APPROVED`, `DEPRECATED`, `RETIRED`, `BLOCKED`.

Required evidence vocabulary SHOULD include:

`PASS`, `FAIL`, `SKIPPED`, `CANCELLED`, `UNVERIFIED`, `STALE`, `MISSING`.

## 22. Acceptance Criteria

- [ ] Every production contract has a stable registry identity.
- [ ] Contract lifecycle states are explicit.
- [ ] Registry is machine-readable.
- [ ] Contract dependencies form a validated graph.
- [ ] Unresolved dependencies block approval.
- [ ] Evidence is bound to contract/artifact commit state.
- [ ] Empty Evidence Registry cannot pass.
- [ ] Missing or unexecuted validator jobs cannot pass.
- [ ] Stale evidence cannot satisfy current validation.
- [ ] Contract changes trigger impact analysis.
- [ ] Version compatibility is explicit.
- [ ] Every production domain has governing contract coverage.
- [ ] Cross-contract invariants are machine-checkable.
- [ ] API operations identify their governing contracts.
- [ ] Registry changes trigger CI validation.
- [ ] CI produces machine-readable evidence.
- [ ] Development admission is fail-closed.
- [ ] Anti-gaming invariants are enforced.
