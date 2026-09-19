# Mapping 0 Verification Lookup — 2026-09-19

Repository: `wanghuinet/luckread`
Authority: GitHub `main`
Audit content baseline: `d6b289f52feeaa04b563e7793441c97a4419f3f5`
Current main after this audit's documentation commits: `fae967636a2faff3f37a4374975c37ea96a95b38`

## Purpose

This document is the first lookup point for future Mapping 0 conversations. It prevents two opposite errors:

1. repeating a validation that remains reusable because its tested inputs are unchanged;
2. reusing historical evidence after its validity boundary or tested subject has changed.

This is a governance/lookup record. It does not promote any Mapping 0 status.

## Current-head change relation

The audited content baseline is 38 commits ahead of the structural verification baseline:

- structural verification baseline: `dfa9af34546fe357c3b83d2b076b9852a04e5542`
- audited content baseline: `d6b289f52feeaa04b563e7793441c97a4419f3f5`
- later audit-only commits: `fae967636a2faff3f37a4374975c37ea96a95b38`

The GitHub compare for this range shows changes in persistence inventory/registry, evidence registry, CI/workflow files, security-gate code, archived legacy Payload files, and Mapping 0 governance artifacts.

No `cross-system-mapping.v1.json` or master Feature Inventory change is present in that compare result.

Therefore the structural 449/449 cardinality result remains a reusable historical fact for unchanged structural inputs, but it is not mislabeled as a fresh current-HEAD workflow certificate.

## Verification reuse matrix

| Item | Historical proof | Current disposition | Re-run trigger |
|---|---|---|---|
| Feature Inventory count = 449 | Structural verifier run `35366756352` / job `105670983591` | REUSE FACT | Feature Inventory changes |
| Canonical Mapping count = 449 | Same structural run | REUSE FACT | Canonical Mapping changes |
| Missing/orphan structural records = 0/0 | Same structural run | REUSE FACT | Feature Inventory or Canonical Mapping changes |
| Structural result `MAPPING_0_STRUCTURAL_GREEN` | Same run | HISTORICAL; not a current-HEAD certificate | Structural verifier inputs/workflow change, or a fresh certificate is explicitly required |
| Entity Catalog = 10; 1 verified / 9 proposed | Same run | REUSE HISTORICAL STRUCTURAL RESULT; freshness depends on source changes | Entity catalog changes |
| Entity-field contract = 10/10; schema PASS | Same run | REUSE HISTORICAL RESULT | Entity/field contract or schema changes |
| Evidence-reference coverage = 449/449; 0 broken refs | Batch G / structural evidence-reference sweep | REUSE REFERENCE-INTEGRITY FACT | Canonical references or referenced artifacts change |
| Batch G orphan governance = 58/58, pending = 0 | Batch G run + disposition register | REUSE / CLOSED | Orphan set, canonical scope, or disposition register changes |
| Canonical scope protection | Batch G + change-control records | REUSE / CLOSED | Feature Inventory or scope decision changes |
| AUTH-001 W01 path alignment | Persisted mapping/evidence/path corrections | REUSE | W01 authority path changes |
| USER W01 code/evidence path alignment | Persisted corrections | REUSE | W01 authority path changes |
| AUTH-002 local schema B05 | Evidence Registry `EVD-AUTH002-B05-SCHEMA-LOCAL-001` | EXPIRED historical evidence | Re-execute for fresh evidence |
| AUTH-002 local migration B06 | Evidence Registry `EVD-AUTH002-B06-MIGRATION-LOCAL-001` | EXPIRED historical evidence | Re-execute for fresh evidence |
| AUTH-002 local runtime B07 | Evidence Registry `EVD-AUTH002-B07-RUNTIME-LOCAL-001` | EXPIRED + OPEN gaps | Re-execute after relevant runtime fixes |
| AUTH-003..010 W01 runtime audit | B08 evidence records | HISTORICAL BLOCKED / stale | Re-execute only after implementation or subject changes |
| AUTH-002 runtime GAP-07-01 | 2nd logout observed 400 vs contract 200 | OPEN fact | Re-test after idempotency change |
| AUTH-002 runtime GAP-07-02 | Concurrent login produced two valid sessions | OPEN fact | Re-test after concurrency/session policy change |
| AUTH-002 runtime GAP-07-03 | Extension correlation not satisfied | OPEN fact | Re-test after extension correlation implementation/change |
| Feature→Entity→Persistence registry | Current registry contains AUTH-002, MIXED, BLOCKED | CURRENT FACT | Registry/contract changes |
| AUTHZ/ORG authority coverage | Current authority coverage artifact | CURRENT FACT, still not feature-level closure | Authority bindings change |
| AUTH-006 classification ambiguity | Change Control record | CURRENT OPEN GOVERNANCE ITEM | Classification rule or authoritative API/DTO/entity evidence changes |
| Contract CI failure with zero visible jobs | Persisted diagnostic | CURRENT OBSERVATION, not root-cause proof | Workflow/platform/run behavior changes |
| Chat-only progress questions | Conversation history | NOT EVIDENCE | Never use as technical proof |

## Historical evidence that must not be reinterpreted

The following are real historical records and should not be described as if they never happened:

- structural Mapping 0 449↔449 verification;
- evidence-reference integrity 449/449;
- Batch G orphan disposition closure;
- AUTH-001/USER W01 path corrections;
- AUTH-002 B05/B06/B07 local evidence and their explicitly recorded runtime gaps;
- entity/persistence semantic correction;
- AUTH-002 persistence mode correction from `LUCKREAD_EXTENSION` to `MIXED`;
- AUTHZ/ORG coverage refresh;
- AUTH-006 classification Change Control;
- Contract CI zero-job diagnostic.

The stale/expired label applies to freshness/current-validity, not to historical existence.

## What is still not established

The following remain genuinely incomplete and must not be mistaken for duplicate verification:

- complete technical closure remains 0/449;
- persistence ownership remains incomplete;
- fresh executable evidence remains unavailable;
- AUTH-002 runtime gaps remain open;
- AUTH-003..006 persistence/runtime evidence remains unverified;
- five-way reconciliation remains NOT_GREEN;
- AUTH residual authority gaps remain fail-closed.

## Anti-duplication rule

Before any new Mapping 0 validation, look up:

`verificationId + testedCommit + testedScope + result + evidenceRef + validity`

Decision:

- same tested inputs + still-valid evidence -> REUSE;
- same structural inputs but later unrelated commits -> REUSE FACT, do not call it a fresh current-HEAD certificate;
- tested subject changed -> TARGETED REVALIDATION;
- evidence expired -> REVALIDATION REQUIRED;
- chat-only claim -> NOT EVIDENCE;
- unknown history -> AUDIT FIRST.

## Final governance statement

No blanket “re-run all Mapping 0 checks” is justified from the current history.

The correct behavior is selective:

- reuse stable structural/reference/governance facts;
- revalidate only changed or expired evidence;
- keep unresolved technical mappings fail-closed;
- never count conversational repetition as verification;
- never promote a historical PASS merely because a record exists.

## 8. Latest referential-integrity audit

A read-only audit was persisted at `artifacts/mapping-0/technical-edge-reference-audit-2026-09-19.json`.

It confirms the currently materialized technical edges can be separated into:

- API bindings: existing canonical inventory/OpenAPI references for AUTH-001, AUTH-002, AUTH-012, USER-001 and USER-006;
- API IDs still absent from canonical API inventory/OpenAPI: AUTH-003..006 and AUTH-010;
- AUTH-011 `authRefresh`: present in the API/OpenAPI sources but still tagged `DISCOVERY_DRAFT`, so it is not treated as admitted canonical API evidence;
- Entity IDs: all currently materialized entity IDs resolve to Entity Catalog IDs, but several remain PROPOSED/CONTRACTED_NOT_VERIFIED and therefore do not prove implementation/persistence;
- AUTH-001 Payload edge: resolves to active W01 `users` collection, whose observed fields are empty.

This audit is reference-integrity evidence only. It does not promote any Feature status and does not replace the full Mapping → Contract → Runtime → Evidence gate.

## 9. Latest 43-blocker authority cross-check

`artifacts/mapping-0/explicit-blocker-authority-crosscheck-2026-09-19.json` checked all 43 explicit blocker Features without changing canonical status:

- 28 materialized API references checked; 11 exist in API Inventory and occur exactly once in OpenAPI.
- 18 materialized Entity references checked; all 18 resolve to Entity Catalog IDs.
- The remaining 17 API references are not admitted by the canonical API inventory/OpenAPI boundary, or are reserved/discovery-only; they remain fail-closed.
- Entity Catalog resolution still does not prove implementation or persistence.

This is an authority/reference cross-check, not technical closure.

## 10. Latest legacy Payload path audit

`artifacts/mapping-0/legacy-payload-reference-audit-2026-09-19.json` confirms that the active AUTH-002 workflows use `workers/W01-payload/` and do not read the legacy root. The remaining legacy machine-readable references are:

- `contracts/entity/entity-field-contract.v1.json`: six ENT-USER fields still reference legacy `src/collections/Users.ts`; existing Change Control blocks unilateral correction.
- `contracts/alignment/code-evidence-inventory.v1.json`: six historical FIELD evidence records reference the legacy root; they are explicitly non-authoritative for W01 and must not be promoted.

No implementation or mapping status was changed by this audit.

## 11. Latest API → OpenAPI → Policy → DTO cross-check

`artifacts/mapping-0/api-dto-four-layer-crosscheck-2026-09-19.json` checked the 10 API operation references from explicit blocker features that are already present in the canonical API Inventory:

- 10/10 exist in API Inventory.
- 10/10 have exactly one `operationId` line in canonical OpenAPI.
- 4/10 have a corresponding AUTH operation-policy entry.
- 2/10 have `CONTRACT_BOUND` DTO records (AUTH-001 register and AUTH-002 login).
- 1/10 is explicitly `NO_BODY_DTO` (AUTH-002 logout).
- `authRefresh` remains `DISCOVERY_DRAFT` and therefore is not treated as admitted canonical API evidence.

This cross-check validates authority references only. It does not establish runtime implementation, persistence, security E2E, or GREEN status.

## 12. DTO representation GAP registered

A model-level GAP is now persisted at `docs/change-control/CC-MAPPING-0-DTO-REPRESENTATION-GAP-2026-09-19.md`.

It records that DTO authority already exists for AUTH-001 and AUTH-002 login, while Canonical Mapping schema has no DTO edge property. This is a governance/model decision point, not a missing-contract discovery. No Mapping Schema change or status promotion has been made.

## 13. Canonical API operationId collision registered

The global API/OpenAPI set audit found no set-membership drift: both sources contain 151 operation rows / 150 unique IDs. The single duplicate is `getEntitlements`, appearing for both `/entitlements/{subjectId}` and the `/entitlements` discovery-draft declaration.

This is already registered under `docs/change-control/CC-MAPPING-0-OPENAPI-DUPLICATE-GET-ENTITLEMENTS-2026-09-19.md`. Do not rediscover it as a new gap and do not auto-rename/delete either operation without Change Control.

## 14. AUTH-003 operationId source conflict registered

AUTH-003 is now explicitly registered as an operationId reconciliation conflict: Canonical Mapping/feature-contract operations use `authCredentialList/add/replace/remove`, while the shared persistence mapping uses `authUsernameCreate/Change`, `authEmailAdd/Change`, and `authPhoneAdd/Change`. Existing AUTH-003 reconciliation documents already classify the latter as stale/unreconciled pending authoritative API admission.

See `docs/change-control/CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19.md`. Do not choose a preferred operation vocabulary outside Change Control.

## 15. Consolidated AUTH D1-domain conflict register

The already-detected logical domain naming conflict `D1-01` vs `D01 Core` affects AUTH-006, AUTH-013 and AUTH-015. It is consolidated at `artifacts/mapping-0/auth-d1-domain-conflict-register-2026-09-19.json` and governed by `docs/change-control/CC-MAPPING-0-D1-DOMAIN-NAMING-CONFLICT-2026-09-19.md`.

Do not rediscover or independently rename the domain per Feature. One authority decision must be applied consistently after Change Control.

## 16. Resolved Change Controls — metadata closure

- `CC-MAPPING-0-CANONICAL-MAPPING-GENERATOR-DRIFT-2026-09-17`: CLOSED after the authorized Option A resolution was executed and verified; historical finding retained, no need to rediscover.
- `CC-MAPPING-0-EVIDENCE-STATUS-DRIFT-2026-09-19`: CLOSED for its narrow evidence-label correction scope; underlying AUTH-002 runtime gaps remain OPEN and require fresh evidence.

Do not reopen either finding unless the underlying authoritative inputs change.

## 17. Current Change-Control decision queue

Current OPEN governance decisions are consolidated in `artifacts/mapping-0/current-change-control-decision-queue-2026-09-19.json`. The queue currently contains 8 OPEN controls and 2 scoped CLOSED controls. Consult this queue before creating a new Mapping 0 finding.

## 18. USER-001/USER-006 blocker precision audit

The evidence-bound USER delta is present on current `main`. USER-001 already has explicit API/Entity edges, so its historical B02 blocker wording is stale and is tracked by `docs/change-control/CC-MAPPING-0-USER-001-006-BLOCKER-PRECISION-2026-09-19.md`. USER-006 has explicit API/policy evidence but still lacks feature-bound Entity/Field and downstream executable closure. See `artifacts/mapping-0/user-001-006-blocker-precision-audit-2026-09-19.json`. No Feature status was promoted.

## 19. Current-HEAD API/Entity edge freshness audits

- `artifacts/mapping-0/current-head-api-edge-audit-2026-09-19.json`: 449 mapping records, 28 API edge refs, 11 admitted in API Inventory/OpenAPI, 17 unresolved admissions; one pre-existing OpenAPI duplicate operationId `getEntitlements`. Reference-integrity audit only.
- `artifacts/mapping-0/current-head-entity-edge-audit-2026-09-19.json`: 18 Entity edge refs across 5 unique Entity IDs; 18/18 resolve to Entity Catalog; no unresolved Entity identifier refs. Entity implementation/persistence status remains separate.

## 20. Current-HEAD Persistence / Code Evidence reference audit

`artifacts/mapping-0/current-head-persistence-code-evidence-audit-2026-09-19.json` is the corrected current-HEAD audit. Persistence inventory: 28/28 path-like references resolve. Code Evidence Inventory: 376/376 path-like references resolve. Initial apparent missing reference was an audit-parser false positive caused by a multi-path `sourceOfTruth` string; the parser was corrected and rerun. No Entity status, persistence status, runtime evidence or Feature status was promoted.

## 21. AUTH-002 preflight DTO source drift — CLOSED

`scripts/auth-002-mapping0-preflight.mjs` and `.github/workflows/auth-002-promotion-matrix.yml` previously referenced archived `contracts/dto/auth-dto-records.v1.json`. They now use the current canonical `contracts/dto/auth-dto-contract.v1.json` shape. The validator checks AUTH-002 login `CONTRACT_BOUND`, logout `NO_BODY_DTO`, and stable persistence DTO refs. See `docs/change-control/CC-MAPPING-0-AUTH-002-PREFLIGHT-DTO-SOURCE-DRIFT-2026-09-19.md`. Underlying AUTH-002 technical/runtime gates remain open.

## 22. W01 Media collection/entity authority GAP

Current Payload Contract Reconciliation reports `workers/W01-payload/src/collections/Media.ts:Media` as unmapped because the current Entity Catalog has no matching canonical Entity implementationRef. This is registered at `docs/change-control/CC-MAPPING-0-W01-MEDIA-COLLECTION-ENTITY-AUTHORITY-GAP-2026-09-19.md`. Do not create/delete/remap the collection without authority resolution.

## 23. Current-HEAD closure re-observation — 2026-09-19

`artifacts/mapping-0/current-head-reobservation-2026-09-19.json` records a fresh read of `main` at `cd5ed7d39f0aadb5ca93fcc862aec7dc026152c7`.

Observed baseline remains **449/449** Feature Inventory ↔ Canonical Mapping, with UNRESOLVED=433, PARTIAL=14, MISSING=2; structural orphan count is `0`. Five-way reconciliation remains `NOT_GREEN` with the same 449-record distribution.

The 11 Evidence Registry records are all past their `validUntil` at this review date; no stale evidence was promoted. The feature↔entity↔persistence registry still has one `BLOCKED` record (AUTH-002). Current W01 Payload discovery remains `users(fields=0)` plus `media(alt)`, so the existing W01 ENT-USER source conflict and Media Entity authority GAP remain governing controls.

The latest directly observed Contract CI run is still run `35421384870` against earlier commit `09176edcc5033d68fc0f4bbc090036615fbeaa27`, not the current `main` commit. Its structural/contract admission matrix and Feature Inventory passed; Semantic and Payload reconciliation failed on the already-registered `getEntitlements` / `getEntitlementsOp` and W01 field/Media authority blockers. This is **not** treated as a current-head technical certificate.

No Canonical Mapping, Feature Inventory, Entity Catalog, Payload collection, DTO authority, operationId authority, persistence status, runtime evidence or Feature status changed in this re-observation.

## 24. Current Change-Control queue refresh

`artifacts/mapping-0/current-change-control-decision-queue-2026-09-19-v2.json` supersedes the earlier queue snapshot.

Current governed OPEN controls: 9, including the W01 Media collection/entity-authority GAP. Scoped CLOSED controls: 4, including Semantic Draft Scope and AUTH-002 preflight DTO source drift. CLOSED here refers only to the recorded governance/tooling scope; underlying technical/runtime gaps remain governed separately.

This queue is now the preferred lookup before opening another Mapping 0 Change Control. It does not authorize implementation or status promotion.

## 25. Current-HEAD Contract CI failure evidence — 2026-09-19

`artifacts/mapping-0/current-head-contract-ci-failure-evidence-2026-09-19.json` records the direct executable result for `Contract CI` run `35424118681` at the then-current HEAD `ab561ea128deef12c0157a7c227564285580004f`.

Observed failing gates were exactly: Semantic Cross-Contract Gate and Payload Contract Reconciliation Gate. Observed passing gates included the Mapping 0 Structural/Contract Gate, Feature Inventory Gate, and all five domain admission matrix jobs.

Semantic failures remain the already-governed `getEntitlements` duplicate plus `getEntitlementsOp` OpenAPI/policy mismatch. Payload failures remain the six ENT-USER fields absent from W01 Users discovery and the unmapped W01 Media collection. No automatic repair, status promotion, Entity creation, operationId rename, or business implementation was applied.

Because this evidence was captured before the evidence-recording commit itself, it is a historical executable observation of the exact tested HEAD, not a certificate for later commits.

## 26. getEntitlements operationId root-cause refinement

`artifacts/mapping-0/get-entitlements-operationid-root-cause-2026-09-19.json` records a current-head source inspection showing that `scripts/sync-rc-openapi.mjs` appends `Op` when a generated operationId collides inside its consolidated policy set.

This explains how `getEntitlementsOp` can arise from the existing `getEntitlements` collision. It is root-cause evidence only; the existing `CC-MAPPING-0-OPENAPI-DUPLICATE-GET-ENTITLEMENTS-2026-09-19` remains OPEN and authoritative. No operation was deleted or renamed.

## 27. W01 ENT-USER source-existence refinement

`artifacts/mapping-0/w01-ent-user-source-existence-audit-2026-09-19.json` records a direct path probe: active W01 `workers/W01-payload/src/collections/Users.ts` exists and currently has `fields: []`; legacy repository-relative `src/collections/Users.ts` could not be resolved on the tested current commit or the previously recorded queue-head.

Therefore the six ENT-USER field contract source references should be treated as historical/non-current references, not implementation evidence. The existing `CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18` remains OPEN/BLOCKED; no fields or contract statuses were changed.

## 28. Active runtime boundary sweep

`artifacts/mapping-0/active-runtime-boundary-sweep-2026-09-19.json` records a repository search at `7fe476a8d02bd0163ad21ae4c28d8921876891c8`.

No active code or workflow reference to D1-Fabric was identified. Active W01 runtime/workflow references remain under `workers/W01-payload/`. Legacy-root references remain historical/governance references and are not treated as current implementation.

The W01 Users source still has zero business fields, while the six ENT-USER field references point to the unresolved legacy source path. No contract, field, Entity, migration or Feature status was changed.

## 29. W01 legacy Payload archive-location correction

The legacy Users collection was verified at `archive/legacy-payload-root/src/collections/Users.ts`; its six historical fields are `username`, `displayName`, `bio`, `avatar`, `locale`, and `timezone`. `archive/legacy-payload-root/README.md` explicitly marks this tree as historical and names `workers/W01-payload/` as the active runtime authority.

This corrects the earlier shorthand that the legacy file did not exist; the precise fact is that it no longer exists at the old repository-root path because it was archived. It remains non-authoritative for active W01 implementation. See `artifacts/mapping-0/w01-ent-user-source-existence-audit-2026-09-19.json` and the existing W01 ENT-USER Change Control.
