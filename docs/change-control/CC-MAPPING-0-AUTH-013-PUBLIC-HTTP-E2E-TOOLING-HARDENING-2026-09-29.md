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


## Follow-up execution reconciliation — run 36458036138

A second manual execution reached the exact deployment provenance and the evidence-tooling checkout, but failed before the W01 install step because the second `actions/checkout@v4` used the default workspace root and cleaned the sibling `deployed-source/` checkout.

Admitted correction:
- the current evidence-tooling checkout now uses `path: evidence-tooling`;
- fixture and public-transport scripts are invoked from `evidence-tooling/scripts/`;
- the exact deployed runtime remains isolated under `deployed-source/`.

No runtime source or contract/schema authority changed.

## Follow-up execution reconciliation — run 36478898506

- Run `36478898506` passed deployment provenance, deployed-source isolation, locked W01 dependency installation, Payload 3.90.2 admission, and fixture generation.
- The preflight failed on `user_collision`. The prior randomized positive INTEGER range is still reachable by existing remote users.
- Cleanup/verification did not constitute behavior evidence because the fixture was never seeded; the cleanup verifier also reported the generated IDs as still present under the fail-closed workflow path.
- Admitted tooling-only correction: disposable Payload user IDs are now randomized **negative** SQLite INTEGER values, outside the positive auto-generated Payload user-id sequence, while the existing collision preflight remains mandatory.
- Backup before correction: `backup/pre-auth013-negative-fixture-20260929-202609282030`.
- No AUTH-013 route, Contract, D1 schema, Payload version, Worker topology, or runtime authority changed.


## Follow-up execution reconciliation — run 36479891510

- Run `36479891510` used the corrected checkout isolation and reached the remote D1 preflight, but still failed closed on `user_collision` even with negative randomly generated INTEGER IDs. This proves the remote `users` table contains IDs outside the assumed positive-only namespace; further random signed-ID selection is not an acceptable control strategy.
- Admitted correction: fixture users no longer provide explicit IDs. The seed lets SQLite/Payload allocate native INTEGER primary keys, then resolves the two fixture IDs by their unique run-scoped emails and exports them to the workflow environment for the HTTP/D1 assertions.
- Preflight now checks collision of unique fixture emails/usernames plus session/role IDs; user primary-key collision is eliminated by database allocation rather than by guessing an unused integer.
- Cleanup now resolves fixture users by their unique emails, so partial seed failure cannot leave cleanup dependent on an unresolved generated user ID.
- Backup before this correction: `backup/pre-auth013-db-generated-user-id-20260929-202609282045`.
- Runtime route, Contract, D1 schema, Payload version, Worker topology, and authority remain unchanged.


## Follow-up execution reconciliation — run 36497430139

- Run `36497430139` successfully reached the revised database-generated user-id path, but failed closed at preflight on `email_collision`; no fixture seed or public HTTP assertions executed.
- To remove any dependency on GitHub run-id uniqueness or assumptions about remote historical cleanup, fixture emails and usernames are now based on a fresh random UUID generated for each workflow execution. Existing collision preflight remains mandatory.
- User IDs continue to be allocated by SQLite/Payload and resolved after seed; cleanup remains keyed by the same unique fixture emails.
- Backup before this correction: `backup/pre-auth013-random-fixture-identity-20260929-202609290715`.
- No AUTH-013 runtime route, Contract, D1 schema, Payload version, Worker topology, or authority changed.


## Follow-up safety reconciliation — cleanup guard

- The workflow previously ran synthetic-fixture cleanup under `if: always()` even when preflight failed before seeding. That created a theoretical risk that a pre-existing row matching the fixture identity could be deleted if the identity check ever collided.
- The admitted correction sets `AUTH013_FIXTURE_SEEDED=1` only after the remote seed command succeeds, and gates both cleanup and cleanup verification on that flag.
- Backup before correction: `backup/pre-auth013-cleanup-guard-20260929-202609290720`.
- This is evidence-tooling safety hardening only; runtime Contract, D1 schema, Payload version, Worker topology, and authority are unchanged.
