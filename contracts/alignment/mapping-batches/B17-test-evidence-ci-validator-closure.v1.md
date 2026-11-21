# B17 — Test / Evidence Registry / CI / Canonical Validator Closure v1.0

**Status:** BLOCKED_UNTIL_EVIDENCE  
**Purpose:** define the final machine-verifiable admission gate for Mapping 0 without fabricating test results, evidence, mappings, or GREEN status.

## 1. Scope

B17 covers the closure boundary shared by every Mapping 0 feature family:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

B17 does not create missing API/DTO/entity/field/code IDs. It only defines the evidence and validator requirements needed to promote already-declared mappings.

## 2. Verified repository baseline

The repository already exposes Contract CI and API Contract CI scripts through `package.json`:

- `contract:ci` → `node scripts/contract-ci.mjs`
- `api:contract:ci` → `node scripts/api-contract-ci.mjs`
- `payload:admission` → `node scripts/payload-implementation-admission-check.mjs`
- `payload:native:verify` → inventory generation followed by clean-diff verification
- `feature:inventory:verify` → feature inventory generation followed by clean-diff verification

These commands are existing implementation evidence for validator entry points; their existence does **not** prove Mapping 0 GREEN. The current Contract CI implementation validates JSON contract domains, state machines, authorization invariants, and OpenAPI structure, but it does not by itself prove the full Feature→Evidence graph.

## 3. Evidence Registry minimum record

Every canonical mapping record MUST be independently evidence-bound with:

1. canonical feature ID;
2. capability ID;
3. API operation ID / OpenAPI path and method;
4. request DTO ID and response DTO ID;
5. entity ID;
6. every persisted field ID used by the capability;
7. persistence authority;
8. Payload collection/config reference where applicable;
9. concrete migration ID/path where persistence exists;
10. concrete table/column mapping where persistence exists;
11. authorization policy/catalog reference;
12. resource scope / ownership rule;
13. account-state precondition;
14. lifecycle/state transition reference;
15. implementation/code reference;
16. unit/integration/security/E2E test reference as applicable;
17. evidence artifact reference;
18. evidence-producing commit SHA;
19. verification result and timestamp when execution evidence exists.

Missing evidence is not equivalent to an empty field. Missing evidence is a blocking state.

## 4. Validator invariants

The canonical validator MUST fail closed when any of the following occurs:

- feature has no canonical owner;
- feature references undeclared capability/API/DTO/entity/field IDs;
- API lacks DTO mapping;
- DTO lacks entity/field mapping where persistence is required;
- canonical persisted field lacks concrete persistence evidence;
- persistence evidence lacks migration/schema evidence;
- security-sensitive operation lacks explicit authorization evidence;
- lifecycle-sensitive operation lacks account-state/lifecycle evidence;
- implementation/code reference is absent for a claimed implemented feature;
- test reference is absent for a claimed tested feature;
- evidence registry reference is absent;
- evidence points only to prose, a plan, or an assumption;
- evidence SHA is absent or cannot be tied to the referenced artifact;
- duplicate canonical authority exists;
- extra authoritative implementation exists outside the canonical mapping;
- mapping status is `UNRESOLVED`, `MISSING`, `CONFLICT`, `DUPLICATE`, `DRIFT`, `EXTRA`, or `BLOCKED`;
- evidence registry is empty for a feature claimed GREEN;
- validator itself cannot load a required registry.

## 5. GREEN promotion rule

A feature may be `GREEN` only when all mandatory links are concrete and evidence-bound.

A batch may be `GREEN` only when every feature in that batch satisfies the feature GREEN rule.

Mapping 0 may be `GREEN` only when:

```text
all canonical mapping records = GREEN
AND
all required entity/field records = GREEN
AND
all required persistence records = GREEN
AND
all required security/lifecycle records = GREEN
AND
Evidence Registry is non-empty and complete
AND
canonical validator passes
AND
Contract CI passes
AND
API Contract CI passes
AND
relevant test gates pass
AND
no blocking drift/duplicate/extra records exist
```

No percentage-based approximation may override this gate.

## 6. Test evidence classes

Tests must be classified rather than counted indiscriminately:

- `UNIT`: pure domain/validation behavior;
- `INTEGRATION`: API + persistence/adapter behavior;
- `SECURITY`: authorization, scope, account-state, credential exposure and bypass invariants;
- `LIFECYCLE`: state transition and recovery/deletion semantics;
- `E2E`: externally observable end-to-end contract behavior;
- `MIGRATION`: migration application/status/schema verification;
- `CI`: deterministic validator/contract gate execution.

A feature requiring persistence cannot claim full GREEN from unit tests alone. A privileged capability cannot claim full GREEN without security evidence. A lifecycle-changing capability cannot claim full GREEN without lifecycle evidence.

## 7. Evidence provenance rule

Evidence must be attributable to a concrete repository artifact or executed CI/test result. Valid evidence includes:

- canonical contract files;
- source implementation files;
- generated schemas/types when generated artifact is authoritative;
- migration files;
- test files and their execution results;
- CI workflow definitions and completed workflow results;
- validator output;
- evidence registry entries tied to the producing commit SHA.

The following are insufficient by themselves:

- a design document saying an API exists;
- a Payload adapter declaration;
- a migration directory declaration;
- a guessed table/column name;
- an expected Payload internal table;
- historical conversation state;
- a planned test;
- a `CLOSED` blueprint batch label.

## 8. Drift detection

The validator must detect at least:

`CONTRACT_WITHOUT_IMPLEMENTATION`  
`IMPLEMENTATION_WITHOUT_CONTRACT`  
`DTO_WITHOUT_API`  
`ENTITY_WITHOUT_FIELD_MAPPING`  
`FIELD_WITHOUT_PERSISTENCE_EVIDENCE`  
`PERSISTENCE_WITHOUT_AUTHORITY`  
`SECURITY_WITHOUT_ENFORCEMENT`  
`LIFECYCLE_WITHOUT_TEST`  
`TEST_WITHOUT_CANONICAL_TARGET`  
`EVIDENCE_WITHOUT_CANONICAL_TARGET`  
`DUPLICATE_CANONICAL_AUTHORITY`  
`EXTRA_AUTHORITATIVE_IMPLEMENTATION`

Any such condition is blocking until explicitly reconciled by contract authority.

## 9. Current status

B17 remains `BLOCKED_UNTIL_EVIDENCE` because the canonical Mapping 0 registry still contains unresolved records. Existing CI scripts prove that contract validation infrastructure exists, but do not prove that the complete Mapping 0 graph is validated.

The repository's existing Contract CI is therefore treated as a prerequisite, not as a substitute for the Mapping 0 canonical validator/evidence gate.

## 10. Development gate

**Base/Worker implementation remains prohibited while Mapping 0 is not GREEN.**

Do not change canonical feature status merely because this gate document exists. Do not generate implementation code to satisfy an unresolved mapping by inference.

## 11. Exit criteria for B17

B17 can move from `BLOCKED_UNTIL_EVIDENCE` to `GREEN` only after the repository contains:

1. a canonical Evidence Registry with non-empty records for all claimed GREEN mappings;
2. a canonical Mapping 0 validator that loads the registry and fails closed;
3. deterministic detection of unresolved/duplicate/drift/extra mappings;
4. executable Contract CI + API Contract CI integration;
5. test/evidence references bound to canonical feature IDs;
6. real execution evidence for required test classes;
7. a final validator result tied to a commit SHA.

Until all seven conditions are met, the correct state is NOT_GREEN/BLOCKED.

## 12. Next batch

B18 — final Mapping 0 consolidation audit: reconcile canonical registry, entity/field/persistence/API/DTO/security/lifecycle mappings, Evidence Registry, validator output, and CI evidence; only then evaluate whether Mapping 0 can become GREEN.
