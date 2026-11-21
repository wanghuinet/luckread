# Change Control: Subscription Version-CAS Implementation Candidate — 2026-10-27

- Change Control ID: `CC-MON-SUBSCRIPTION-VERSION-CAS-IMPLEMENTATION-2026-10-27`
- Status: `IMPLEMENTATION-CANDIDATE / CI-REQUIRED / NOT-DEPLOYABLE`
- Supersedes: `CC-MON-SUBSCRIPTION-VERSION-CAS-2026-10-02` only for preparing a reviewed code change and additive migration artifact; it does not authorize remote execution.

## Scope

- Add an additive D1-01 migration that creates the contracted `version INTEGER NOT NULL DEFAULT 1` field.
- Use the persisted monotonic `version` as the compare-and-set (CAS) authority for subscription state and plan mutations.
- Represent that version through ETag metadata while comparing the numeric version in the SQL write predicate.
- Keep subscription reads scoped to the subscriber and preserve idempotent converged retries.
- Extend runtime tests and static SQLite migration verification, including an existing-row backfill check.

## Safety invariants

1. Every successful state/plan mutation increments `version` exactly once.
2. Stale versions fail with HTTP 412 unless the same requested state has already converged.
3. `updated_at` is display/audit metadata, not the concurrency authority.
4. The persisted subscription row is never treated as payment confirmation or ledger evidence.
5. The migration is additive; existing rows must receive version 1.

## Explicit non-actions

- No remote D1 migration is executed by this change.
- No W07 deployment is executed by this change.
- No D1-04 binding, financial table, or payment endpoint is fabricated.
- No production schema or Evidence Registry status is promoted to verified/GREEN.

## Required before deployment

- All PR CI and independent review pass.
- Read-only inspection proves the exact D1-01 target database, current migration history, schema, and that migration 0002 has not already been applied.
- The migration artifact hash, remote post-migration schema, W07 deployed revision, concurrency E2E evidence, and Evidence Registry references are recorded.
- Payment-to-entitlement transitions remain separately gated by verified provider events and the authoritative D1-04 financial path.
