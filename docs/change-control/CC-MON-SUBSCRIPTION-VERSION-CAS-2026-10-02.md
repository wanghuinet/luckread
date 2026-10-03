# Change Control: Subscription Concurrency Version Field — 2026-10-02

- Change Control ID: `CC-MON-SUBSCRIPTION-VERSION-CAS-2026-10-02`
- Status: `CONTRACT-FIRST / ADMITTED / IMPLEMENTATION-BLOCKED`
- Repository baseline: current `main` at branch creation
- Backup: `backup/pre-subscription-contract-reconcile-20261003`
- Work branch: `codex/subscription-version-cas-current-main-20261003`

## Authority

The existing global concurrency contract requires optimistic-lock writes to use an authoritative monotonic resource `version`. ETag is representation metadata and MUST NOT replace `version` as the CAS authority.

## Change

Bind canonical field `ENT-SUBSCRIPTION-F-VERSION` to Subscription.

Semantics:

- integer;
- required / non-null;
- starts at 1;
- increments exactly once for each successful authoritative Subscription mutation;
- used by `If-Match` / `expectedVersion` compare-and-set semantics.

The field is bound into the existing Subscription entity contract and D1-01 logical persistence contract.

## Non-actions

- no remote D1 migration;
- no W07 runtime implementation;
- no new Worker/D1/Payload Collection;
- no ETag authority inversion;
- no GREEN promotion.

The active-subscription uniqueness boundary remains a separate decision item.
