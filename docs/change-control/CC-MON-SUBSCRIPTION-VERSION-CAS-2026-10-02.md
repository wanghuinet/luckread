# Change Control: Subscription Concurrency Version Field — 2026-10-02

- Change Control ID: `CC-MON-SUBSCRIPTION-VERSION-CAS-2026-10-02`
- Status: `CONTRACT-FIRST / ADMITTED / IMPLEMENTATION-BLOCKED`
- Base slice: `#404`
- Backup: `backup/batch-20261002-before-subscription-version`
- Work branch: `codex/subscription-version-concurrency-20261002`

## Authority

The existing global concurrency contract requires optimistic-lock writes to use an authoritative monotonic resource `version`. ETag is representation metadata and MUST NOT replace `version` as the CAS authority.

## Change

Add canonical field:

`ENT-SUBSCRIPTION-F-VERSION`

Semantics:

- integer;
- required / non-null;
- starts at 1;
- increments exactly once for each successful authoritative Subscription mutation;
- used by `If-Match` / `expectedVersion` compare-and-set semantics.

The field is bound into the existing Subscription entity and D1-01 logical persistence contract.

## Non-actions

- no migration;
- no remote schema execution;
- no W07 runtime implementation;
- no new Worker/D1/Payload Collection;
- no ETag authority inversion;
- no GREEN promotion.

The active-subscription uniqueness boundary remains a separate decision item.
