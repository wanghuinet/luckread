# LuckRead 1.0 Reuse Closure — Batch R9 CI / Validator / Evidence v1.0

> Status: **CLOSED / REUSE ALLOCATED / QUALITY-EVIDENCE FOUNDATION LOCKED**

## 1. Objective

Consolidate existing contract validators, CI workflows, machine-readable contracts and evidence-gate assets into one admission model. R9 does not create a second CI framework or a second evidence authority.

Canonical chain:

`Requirement -> Contract -> Machine-readable Contract -> Validator -> CI -> Evidence -> Admission -> Implementation`

The repository already contains a dependency-free contract validator and domain-specific D21 validator/workflow assets. fileciteturn302file5 fileciteturn302file1

## 2. Reuse disposition

| Capability | Canonical owner | Disposition | Decision |
|---|---|---|---|
| Contract CI runner | CI / DEV | DIRECT-REUSE | Reuse `scripts/contract-ci.mjs` |
| Domain contract validators | CI / domain | DIRECT-REUSE | Keep domain-specific validation where required |
| D21 validator | Advertising / CI | DIRECT-REUSE | Domain-scoped validator |
| D21 CI workflow | CI | DIRECT-REUSE | Existing workflow remains authoritative for D21 |
| Machine-readable contracts | Contract Registry | DIRECT-REUSE | Validator input, not duplicate business truth |
| Contract inventory | Contract Registry | MERGE | One canonical inventory view |
| Evidence registry | Evidence | MERGE | One evidence authority |
| Evidence DAG / dependency graph | Evidence | DIRECT-REUSE | Dependencies must be explicit |
| Build baseline | CI / Foundation | DIRECT-REUSE | Build evidence is mandatory |
| Security gate | Security / CI | DIRECT-REUSE | Security failures block admission |
| Contract gate | Contract / CI | DIRECT-REUSE | Contract failures block admission |
| Integration gate | CI | MERGE | Must prove cross-domain behavior |
| Runtime evidence | Evidence | MERGE | Cannot be inferred from static contracts |
| GitHub SHA evidence | Evidence | DIRECT-REUSE | Every accepted change maps to immutable commit evidence |
| Validator PASS without evidence | Evidence | REJECT | Empty/missing evidence cannot default to PASS |
| Validator default PASS | CI | REJECT | Unknown/missing input is BLOCKED/FAIL, never PASS |
| Duplicate validator frameworks | CI | REJECT | Domain validators may exist, but admission is unified |
| Manual green declaration | Evidence | REJECT | Must be backed by executable evidence |

## 3. Evidence is mandatory

The Evidence Registry is not an optional report cache.

For every required gate:

```text
required evidence
 -> evidence exists
 -> evidence identity valid
 -> producer known
 -> source SHA / run known
 -> timestamp known
 -> scope known
 -> status PASS
 -> dependency gates PASS
```

If required evidence is absent, malformed, stale, unknown or contradictory, admission is **BLOCKED**.

There must be no path equivalent to:

```text
Evidence Registry = empty
        -> assume PASS
```

The existing IP-center evidence gate explicitly rejects this behavior. fileciteturn302file7

## 4. Gate semantics

Canonical result states:

```text
PASS
FAIL
BLOCKED
UNKNOWN
SKIPPED (only when explicitly permitted by contract)
```

Rules:

- FAIL blocks admission.
- BLOCKED blocks admission.
- UNKNOWN blocks admission unless the contract explicitly defines an allowed unknown state.
- Missing required evidence blocks admission.
- A skipped gate requires an explicit contract reason and cannot silently become PASS.
- A downstream PASS cannot override an upstream BLOCKED dependency.

## 5. Validator design

Validators must be deterministic and fail closed.

A validator should distinguish:

```text
missing input
invalid input
contract violation
runtime/test failure
evidence failure
PASS
```

Validators must not mutate business truth.

Domain-specific validators may remain where they validate a domain-specific machine-readable contract, but final admission semantics remain unified.

## 6. CI admission graph

Minimum graph:

```text
Contract Integrity
       |
       v
Machine-readable Contract
       |
       v
Validator
       |
       +----> Security Gate
       |
       +----> Build Gate
       |
       +----> Unit Test Gate
       |
       +----> Integration Gate
       |
       +----> Migration / Data Gate
       |
       +----> Runtime / Binding Gate
       |
       v
Evidence Registry
       |
       v
Evidence DAG
       |
       v
Final Admission
```

The graph must prevent a downstream green job from masking a failed prerequisite.

## 7. GitHub SHA evidence

Every implementation batch must produce an immutable chain:

```text
Feature ID
 -> Contract version
 -> implementation commit SHA
 -> CI run
 -> validator result
 -> test result
 -> evidence record
 -> admission result
```

A commit SHA alone proves source identity, not runtime correctness.

A green unit test alone does not prove contract admission.

A contract PASS alone does not prove implementation completeness.

## 8. CI scope rules

CI must test the smallest affected scope while preserving required global gates.

Examples:

- contract-only change → contract validator + affected global admission checks;
- API change → contract + type/build + API tests + affected security/integration tests;
- migration change → migration validation + compatibility + reconciliation tests;
- payment change → contract + financial invariants + idempotency + concurrency + integration tests;
- authorization change → AuthZ + security + ownership/scope + regression tests.

No change may bypass required global security or contract gates merely because the changed file is small.

## 9. Evidence freshness

Evidence has an explicit scope and provenance.

Stale evidence cannot be reused automatically after a relevant contract, code, schema, validator or security change.

At minimum, evidence identity must bind to:

```text
commit SHA
workflow / run identity
validator version
contract version
scope
result
created_at
```

## 10. Security and fail-closed behavior

CI and validators must fail closed for:

- missing contract;
- missing required machine-readable contract;
- malformed registry;
- missing evidence;
- contradictory evidence;
- unknown validator result;
- security gate failure;
- migration compatibility failure;
- authorization regression;
- financial invariant failure.

No CI convenience flag may convert these conditions to PASS.

## 11. Explicit rejection

R9 rejects:

- empty Evidence Registry treated as PASS;
- missing evidence inferred from successful build;
- green build treated as feature completeness;
- domain validator PASS treated as global admission;
- manual comments treated as executable evidence;
- stale evidence reused after relevant code/contract changes;
- duplicate global evidence registries;
- duplicate global admission engines;
- validator mutation of domain data;
- silent `SKIP` without contract authorization;
- `UNKNOWN` treated as PASS;
- downstream green overriding upstream failure.

## 12. Implementation readiness boundary

R9 closes reuse/allocation only. It does **not** claim that the current repository's complete CI pipeline is GREEN.

The actual GREEN decision remains an executable repository state and must be established by running the relevant workflows/tests after implementation changes.

## 13. R9 closure decision

**CLOSED at reuse/allocation level.**

The project now has a single intended admission model for Contract → Validator → CI → Evidence → Admission.

Next and final reuse batch: **R10 — Legacy Code / Temporary Patch Final Disposition.**
