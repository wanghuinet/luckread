# Change Control — AUTH-013 Lifecycle Matrix Evidence Inheritance — 2026-10-04

Status: CLOSED — UNCHANGED-SCOPE EVIDENCE INHERITANCE

Baseline:
- authoritative main before this change: d822a9af98cd4bebc9c36834a5e4597707b3f628
- backup: backup/2026-10-04-pre-auth013-lifecycle-inheritance
- working branch: chore/1.1-auth013-lifecycle-inheritance

## Scope

Reconcile the already successful AUTH-013 lifecycle matrix runtime evidence record:

`EVD-AUTH013-LIFECYCLE-MATRIX-REMOTE-001`

The historical controlled remote run `36527170976` executed the lifecycle matrix against application source SHA:

`56908b2f49845428db7c36520d0d989e70256e33`

No runtime rerun is performed.

## Inheritance proof

The governing inheritance rule permits reuse when authoritative runtime inputs and evidence scope remain unchanged.

Verified byte-level/source identity between the tested source and current main:

- Historical source:
  `workers/W02-content/src/account/account-state-transition.ts`
  Blob SHA: `63c4d57cd0d56228603562d8c4a3c32c30530254`
- Current source:
  `workers/W02-identity/src/account/account-state-transition.ts`
  Blob SHA: `63c4d57cd0d56228603562d8c4a3c32c30530254`

The corresponding test file is also identical:

`workers/W02-content/src/account/account-state-transition.test.ts`
→ `workers/W02-identity/src/account/account-state-transition.test.ts`

Blob SHA:
`8f75ee52b4c2a642f25d96780ab7a1f768cb0829`

Contract inputs are byte-identical between the tested source and current main:

- `contracts/state-machines/account.json`
  - Blob SHA: `1b5a44c4b534c452fb32033ee45bfff38890dd92`
- `contracts/events/identity-account-state-changed.v1.json`
  - Blob SHA: `ae6232c30246e4fb714d382de57e5ffa98a890da`
- `contracts/persistence/AUTH-013-account-state-persistence-contract.v1.json`
  - Blob SHA: `a56b14b189835c8bd43f1ab018fda0205dcbfc0f`

The directory rename from historical `W02-content` to current `W02-identity` does not alter the executable source bytes or the tested lifecycle semantics.

## Original runtime evidence

- Workflow: AUTH-013 Lifecycle Matrix Runtime Evidence
- Run: `36527170976`
- Job: `109272654888`
- Environment: `CONTROLLED_REMOTE_D1_LIFECYCLE_MATRIX`
- D1-01: `2f80471e-3756-49f9-8db1-7707a433ad64`
- Database: `luckread`
- Artifact: `11015405950`
- Result: PASS
- Verified transitions: ACTIVE→RESTRICTED→FROZEN→SUSPENDED→BANNED→RESTORED→ACTIVE
- Verified approval-required BAN, no-mutation rejection, session revocation retention, direct BANNED→ACTIVE rejection, journal versions 2–7, canonical event type, and synthetic cleanup.

## Registry decision

Change only:

`freshnessMode: EXACT_SHA`

to:

`freshnessMode: INHERITED_UNCHANGED_SCOPE`

and bind:

`inheritanceRef: docs/change-control/CC-MAPPING-0-AUTH-013-LIFECYCLE-MATRIX-INHERITANCE-2026-10-04.md`

All historical provenance remains unchanged:
- evidenceId
- claimId
- sourceRef
- commitSha
- timestamp
- producer
- result=PASS
- status=VERIFIED
- original workflow/job identifiers

## Non-promotion

This inheritance closes only the freshness/admission discrepancy for this evidence record.

It does NOT:
- promote AUTH-013 to GREEN;
- promote Mapping 0 to GREEN;
- promote the global Evidence Registry to GREEN;
- prove every remaining cache/deindex/feed/search side-effect edge;
- create any new Worker, D1, Queue, KV namespace, API route, DTO, or Contract.

## Decision

No rerun is required because the authoritative runtime source bytes and contracted lifecycle inputs are unchanged. The historical runtime evidence remains the evidence of execution; the inheritance record is the current-head freshness bridge only.
