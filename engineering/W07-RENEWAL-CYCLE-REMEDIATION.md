# W07 Renewal Cycle Synchronization — Full Engineering Remediation

Repository: https://github.com/wanghuinet/luckread

## Mission

Act as a senior backend engineer. Implement a complete, production-quality remediation of W07 Subscription Commerce renewal synchronization between Membership (D1-01) and Finance (D1-04). This is an implementation task, not an audit-only or documentation task. Make code changes, validate, and submit a PR.

Coordinate with existing W07 work (including PR #2130 and related branches). Inspect the latest repository state and avoid duplicating or overwriting existing changes. Do not merge PRs or deploy.

## Known defects / risk areas

1. Membership cycle application lacks a durable, cycle-specific proof of the applied outcome. Current behavior can infer success from subscription state, period dates and plan data.
2. Finance recovery uses date/status/plan heuristics to infer whether Membership applied a cycle. These heuristics are not authoritative and can incorrectly mark a cycle complete.
3. Subscription CAS, scheduled-plan-change CAS and durable cycle outcome evidence must be transactionally consistent.
4. Retries, concurrency, terminal cycles and failed renewals can produce duplicated application, inconsistent Finance/Membership states or false success if not safely fenced.
5. Failed renewals must not extend the subscription period; cancellation or pause must not be bypassed by renewal logic.

## Phase 1 — Durable Membership Renewal Cycle Ledger

Add a durable cycle-application ledger to the D1-01 Membership PostgreSQL schema. Use repository naming conventions; proposed name: `membership_subscription_renewal_cycle_applications`.

At minimum, preserve:
- cycle_id (unique / primary key)
- subscription_id
- subscriber_id
- cycle_start and cycle_end
- outcome (ACTIVE / PAST_DUE, aligned to actual model)
- post-application subscription version
- plan_id and plan_version, where applicable
- scheduled_change identity, where applicable
- applied_at
- any additional immutable facts required for integrity and reconciliation

Requirements:
- Database-level uniqueness for cycle_id.
- A cycle cannot be applied twice.
- Ledger records the fact of applying a specific cycle; it must not derive historical facts from current subscription state.
- Matching replay returns ALREADY_APPLIED without repeating effects.
- Replays with conflicting facts fail closed and enter reconciliation.
- Do not mutate existing ledger evidence to represent a different cycle or outcome.

## Phase 2 — Atomic Membership application transaction

Within one PostgreSQL transaction:
1. Check for existing ledger evidence by cycle_id.
2. Validate the immutable cycle facts if evidence already exists.
3. Read and validate the subscription state and version.
4. Apply subscription CAS.
5. Apply scheduled plan-change CAS/markers, if applicable.
6. Insert cycle ledger evidence.
7. Commit.

All steps must be atomic. Roll back on CAS miss, scheduled change failure, ledger insert failure or other transaction errors. Never return success without durable evidence. A concurrent winner must be handled by safely rereading and validating its ledger evidence, not by inferring success from dates or status.

## Phase 3 — Finance/Membership synchronization and recovery

Refactor Finance recovery to rely on Membership ledger evidence, not subscription-period date matching as proof of application.

Recovery must:
- Read and validate the Finance renewal cycle and its terminal state.
- Read Membership cycle evidence.
- Validate cycle_id, subscription_id, subscriber_id, cycle bounds, outcome and applicable business facts.
- Mark Finance synchronized only when the Membership evidence is valid and consistent.
- Treat absent evidence as not applied / retryable according to the state machine; never fabricate success.
- Route fact conflicts to reconciliation.
- Support safe, idempotent retries.
- Account for cross-domain transaction boundaries; do not assume a distributed transaction exists.

Use existing state machines, lease/ownership fencing and reconciliation patterns rather than introducing a parallel framework.

## Phase 4 — Preserve business behavior

Review and preserve all relevant existing behavior:
- trial conversion
- scheduled plan changes (upgrade/downgrade as supported)
- successful renewal
- failed renewal and payment retry
- cancellation and pause
- subscription version CAS
- payment idempotency
- webhook idempotency
- reconciliation and terminal states

Do not reactivate CANCELLED or PAUSED subscriptions through renewal handling. Do not repeat trial conversion or scheduled plan changes. Failed renewal must not advance period dates. Align allowed transitions with existing contracts and actual schema.

## Phase 5 — Schema sources and contracts

Synchronize every authoritative source and generated artifact affected by the schema change:
- D1-01 migration source
- PostgreSQL migration template
- migration generator
- generated PostgreSQL migration
- persistence contract
- entity contract / invariant documentation where needed
- schema/bootstrap inventory if affected
- Worker implementation

Do not patch only generated SQL. Regeneration must produce the committed SQL. Keep domain boundaries: Membership owns renewal application evidence; Finance D1-04 remains authoritative for financial/payment facts.

## Phase 6 — W07 end-to-end closure

Inspect and remediate related defects in the actual W07 flow, including:
- payment submission and callbacks/webhooks
- cycle creation and terminalization
- Membership cycle application
- subscription CAS
- scheduled changes and trial conversion
- success and failure renewals
- Finance synchronization
- retry and reconciliation
- leases, expiry and ownership fencing
- duplicate callbacks, concurrent processing
- cancelled and paused subscriptions

Fix defects directly related to this remediation that are discovered. Do not broaden into unrelated Worker rewrites.

## Implementation / verification expectations

- Start by inspecting current repository state, W07 source, contracts, migrations and existing PR work.
- Work on an isolated branch; coordinate with #2130 instead of duplicating it.
- Implement the complete coherent change, not a series of tiny partial PRs.
- Reuse existing patterns; avoid unnecessary dependencies, tools, scaffolding or unrelated documentation.
- Run applicable existing tests, type checks, generators and CI checks. Fix failures caused by your change.
- Review the final diff and ensure source/template/generator/generated output/contracts agree.
- Do not claim tests, CI or physical schema application that you did not actually verify.
- Commit and open a PR with a clear summary, verification results and remaining risks.

## Permissions / constraints

- You may create branches, commits and PRs.
- Do NOT merge any PR.
- Do NOT deploy.
- Do NOT execute migrations against production or mutate production data.
- Do not change Payload or other upstream open-source core code.
- Preserve existing domain boundaries and unrelated functionality.

## Acceptance criteria

- A renewal cycle is applied by Membership at most once.
- Membership application CAS and durable evidence insertion are atomic.
- Ledger evidence is the authoritative proof of application for a cycle.
- Finance no longer relies on date heuristics to infer application.
- Finance recovery is safely retryable and reconciles conflicts.
- Duplicate/concurrent events cannot extend periods or apply plan changes twice.
- Failed renewals do not extend periods or reactivate cancelled/paused subscriptions.
- Trial conversion and scheduled plan changes remain safe and idempotent.
- Migration source, generator, generated SQL and contracts are consistent.
- The PR contains implementation and truthful verification results, with no merge or deployment.

Deliver code, not merely a report or checklist.
