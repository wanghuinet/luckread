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
