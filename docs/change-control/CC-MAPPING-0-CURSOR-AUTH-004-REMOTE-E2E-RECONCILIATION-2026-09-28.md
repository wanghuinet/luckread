# CC-MAPPING-0-CURSOR-AUTH-004-REMOTE-E2E-RECONCILIATION — 2026-09-28

## Status

`CURRENT_HEAD_RECONCILED / REMOTE_E2E_GATE_OPEN`

## Purpose

Reconcile the authoritative execution cursor after the AUTH-004 Payload 3.90.2 implementation/deployment batch advanced `main` beyond the cursor's former 3.87.1 state.

## Current source

- Current `main`: `39489d6bddcc9a768c9b8c2bd9c18de5c26c0b20`
- Backup created before this batch: `backup/main-before-auth004-batch-20260928-2003`
- W01 Payload family: `3.90.2`
- W01/W02 binding deployment: run `36418911699`
- Deployment conclusion: `success`
- Deployment tested source: exact current `main` SHA above

## Evidence boundary

Already established and inherited without rerun:

- AUTH-004 local native lifecycle evidence: run `36411953998`
- Payload 3.90.2 dependency/version alignment is merged
- W01 build and W01/W02 Service Binding deployment succeeded

The deployment result is **not** remote HTTP/E2E runtime evidence and does **not** promote AUTH-004, the Evidence Registry, or Mapping 0.

## Current remaining AUTH-004 gate

The existing workflow `.github/workflows/auth-004-remote-e2e.yml` and script `scripts/auth-004-remote-e2e.mjs` remain the sole controlled remote evidence path.

The pending evidence dimensions are:

- protected-account / missing-account reset-request enumeration resistance;
- password-change invalidation of all pre-change native sessions;
- password-reset invalidation of pre-reset native sessions;
- single-use recovery-token replay rejection;
- expired recovery-token rejection;
- remote persistence confirmation for Payload-native reset token/expiration;
- secret-free evidence output and cleanup.

No new authentication subsystem, custom session invalidation store, Worker, D1 database, queue, AUTH-004 migration, or Payload core fork is introduced by this reconciliation.

## Non-actions

- No local AUTH-004 lifecycle rerun.
- No AUTH-002/AUTH-003 runtime rerun.
- No duplicate migration execution.
- No Evidence Registry GREEN.
- No Mapping 0 GREEN.
- No entity promotion.

## Next cursor

`AUTH-004-REMOTE-E2E-LIFECYCLE-CLOSURE-001` / `BLOCKED_REMOTE_E2E`

The dedicated current-execution cursor is updated to the exact current `main` SHA and Payload `3.90.2` baseline. Historical cursor text remains historical and must not drive work selection.

## 2026-09-28 controlled rerun checkpoint

- Reused the existing W01/W02 deployment job 108916624653 from run 36418911699; no new business implementation was introduced.
- Attempt 2 is currently in_progress at the W01 build step after exact-source checkout, dependency install, W02 binding validation, and PAYLOAD_SECRET verification passed.
- The deployment remains bound to implementation source 39489d6bddcc9a768c9b8c2bd9c18de5c26c0b20.
- No database migration is part of this deployment workflow.
- No AUTH-004 Remote E2E result is admitted yet.

## 2026-09-28 remote E2E provenance-selector correction

- W01/W02 binding deployment run 36418911699 attempt 2 completed successfully against implementation source 39489d6bddcc9a768c9b8c2bd9c18de5c26c0b20.
- AUTH-004 Remote E2E run 36419964835 failed before the probe executed because the deployment provenance gate required exactly one live artifact while the controlled deployment rerun legitimately produced two live exact-SHA artifacts with the same artifact name.
- The failure was a CI/provenance selector defect, not a Payload runtime, Worker deployment, migration, or AUTH-004 business-behavior failure.
- Minimal correction committed at 7cd8c34e839db53a9798c64b8fa99a2ebeffa5bd: select live deployment artifacts by exact deployment SHA, require at least one, and deterministically use the newest matching artifact while recording ignored duplicate count.
- A fresh controlled rerun of the same W01 deployment job has been started as attempt 3 solely to generate a new successful workflow_run event for the corrected Remote E2E workflow. No new business implementation or schema change was introduced.
- AUTH-004 remains BLOCKED / NOT_GREEN until the corrected Remote E2E actually executes and produces admissible lifecycle evidence.

## 2026-09-28 AUTH-001 native Local API production-runtime correction

- AUTH-004 remote E2E run 36420515576 reached the real W01 runtime and passed exact deployment provenance, Payload 3.90.2 source admission, exact deployed-source probe materialization, and remote Payload migration preconditions.
- The first business assertion then failed at canonical `POST /auth/register`: HTTP 503 from the W01 registration adapter. No AUTH-004 password lifecycle assertion executed after that point.
- The inspected registration seam called `payload.create()` with `context` but did not pass the existing HTTP `Request` object. Payload Local API documents `req` as a supported create option and recommends threading the request through Local API operations; context is propagated to `req.context` for hooks.
- Minimal source correction committed at `6d574bb56222e0eaf44df663e04eb59535e84be6`: `payload.create({ ..., req: request, context })`.
- No new authentication subsystem, schema, Worker, D1, queue, transaction model, or Payload core change was introduced.
- Fresh remote deployment/runtime evidence for this correction is still pending; AUTH-004 remains BLOCKED / NOT_GREEN until the corrected source is deployed through the existing controlled W01 deployment path and the remote lifecycle probe passes.

## 2026-09-28 deployment workflow_run SHA semantics correction

- Controlled W01 deployment run `36420996656` successfully deployed source `6d574bb56222e0eaf44df663e04eb59535e84be6`; its workflow-run `head_sha` was `30bc9030e470e5e8f9a8a43003425c36d6ee1f44` because the deployment is a `workflow_dispatch` against the then-current main branch.
- AUTH-004 Remote E2E run `36421236449` correctly consumed the updated artifact selector but failed because it incorrectly compared the deployment workflow-run `head_sha` to the artifact name. That comparison confuses workflow trigger revision with the actual deployed `source_sha` input.
- Minimal CI correction committed at `65c3dd5423f7c841a64a486ca3a960fb4339e376`: derive the deployed source SHA from live `w01-w02-binding-deployment-*` artifacts belonging to the deployment run, require one unambiguous exact SHA, choose the newest duplicate artifact, and record the workflow trigger SHA separately.
- Re-ran the already successful W01 deployment job `108923397358` to generate a new completion event using the same deployed source. Re-run attempt 2 is currently queued.
- No business implementation, D1 schema, Worker topology, or Payload core change was introduced by this correction.

## 2026-09-28 controlled runtime-tail diagnostic checkpoint

- W01 deployment run `36420996656` attempt 2 successfully deployed the corrected implementation source `6d574bb56222e0eaf44df663e04eb59535e84be6`.
- AUTH-004 Remote E2E `36421837195` reached the exact deployed source and remote migration precondition successfully, then failed at the first registration assertion with HTTP 503. The existing source logs a sanitized `auth.register` diagnostic event, but the E2E artifact did not capture live Worker logs.
- CI-only diagnostic enhancement committed at `67e9080a2617e6c3c381aaaeb4bfd399ca84e1e68`: the existing controlled Remote E2E now starts a temporary `wrangler tail` session filtered to `auth.register`, captures the live W01 runtime diagnostic, and stops the tail after the probe. This does not alter application behavior, schema, topology, or production contracts.
- The already successful W01 deployment job was safely rerun as attempt 3 solely to emit a new completion event for the diagnostic-enabled Remote E2E. The deployed source remains `6d574bb56222e0eaf44df663e04eb59535e84be6`.
- AUTH-004 remains BLOCKED / NOT_GREEN pending the next Remote E2E result and evidence admission.
