# Change Control — Moderation Security E2E External Credential Gate — 2026-10-01

## Purpose
Record the current external blocker for the admitted Moderation runtime Security E2E evidence channel without changing runtime contracts, topology, Worker code, D1 schema, or security semantics.

## Authoritative scope
- Repository: `wanghuinet/luckread`
- Evidence baseline main before this governance record: `7d4eda1b75ebdddd474d7cb14aa0443b09707f56`
- Runtime source under test: `81986b7510efb20a5dd44f9971ca40794989ddff`
- Workflow: `.github/workflows/moderation-runtime-e2e.yml`
- Required repository secret: `MODERATION_E2E_BEARER_TOKEN`

## Evidence observed
The following controlled workflow runs all stopped at the same credential gate:
- `36797669090`
- `36797792430`
- `36797870423`
- `36798890134`

The latest run `36798890134` never executed fixture creation, moderation decision, idempotency replay, precondition checks, remote evidence capture, or artifact upload.

## Decision
Status remains `BLOCKED_EXTERNAL`. The workflow is not to be repeatedly rerun while the required repository secret is absent.

No runtime GREEN status is promoted.

## Record head
- This governance record is now on main at `8d72dc707bfda9f0b24e806fe2b7ced9304fd132`.

## Next execution condition
After the repository secret is provisioned through the GitHub repository settings, execute the existing workflow with its prefilled defaults:
- `source_sha=81986b7510efb20a5dd44f9971ca40794989ddff`
- `base_url=https://luckread.cn`
- `confirm=RUN_MODERATION_E2E`

Then inspect the actual remote decision, audit, outbox delivery, W03 convergence, and evidence artifact before any Evidence Registry reconciliation.

## Non-changes
- No new Worker.
- No new D1.
- No new binding or Queue.
- No Contract/Blueprint semantic change.
- No Payload Core change.
- No distributed transaction.
