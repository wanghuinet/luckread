# Change Control — AUTH-013 Public HTTP E2E Evidence Tooling Hardening

- Date: 2026-09-29
- Status: READY_FOR_REEXECUTION
- Scope: evidence workflow/tooling only
- Runtime authority: unchanged
- Backup before change: `backup/pre-auth013-workflow-collision-d1-transaction-20260929-1205`
- Failed execution reviewed: `36457473345`

## Observed failure

The public E2E run did not execute the AUTH-013 HTTP assertions.

1. Synthetic numeric user IDs were derived from the GitHub run ID and collided with existing remote D1 user IDs during preflight.
2. The cleanup SQL used explicit `BEGIN` / `COMMIT` statements, which the active Wrangler/D1 execution path rejects.

A third issue was identified during reconciliation: the workflow checked out the exact deployed runtime source before running the evidence scripts, so a newer fixture-tooling fix on `main` would not have been used.

## Admitted correction

- Synthetic user IDs are now cryptographically randomized within a safe SQLite integer range; the existing collision preflight remains fail-closed.
- Fixture seeding no longer emits explicit SQL transaction wrappers.
- Cleanup no longer emits explicit SQL transaction wrappers.
- The workflow now keeps the exact deployed source in `deployed-source/` while checking out current `main` at `github.sha` for evidence tooling.
- W01 dependency installation and Payload baseline checks continue against the exact deployed source.
- Wrangler D1 operations continue to use the exact deployed source's `workers/W01-payload/wrangler.jsonc`.

## Non-changes

No AUTH-013 route, Contract, D1 schema, Payload version, Worker topology, session authority, or application runtime source was changed.

## Closure condition

This control is complete only after a fresh manual AUTH-013 public HTTP E2E run passes the existing exact-deployment provenance checks, public HTTP assertions, stale-session denial, authoritative D1 assertions, and fixture cleanup.

No Evidence Registry promotion or Mapping 0 GREEN is implied by this tooling change.
