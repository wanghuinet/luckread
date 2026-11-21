# W10 — Async / Queue / Job Execution

Canonical Worker identity: **W10**
Canonical responsibility: **Async / Queue / Job Execution**
Primary Tasks: **None**

Canonical repository path: `workers/W10-async`.

## Membership renewal Workflow

The existing `luckread-w10` Worker hosts the durable `MembershipRenewalWorkflow`:

- A Workflow binding schedule creates one durable Workflow instance every minute.
- W10 calls only the W07 internal batch endpoint through the `W07_COMMERCE` Service Binding.
- A Workflow step uses bounded exponential retries; Cloudflare persists step completion and resumes from the last successful step.
- Each invocation asks W07 to process at most one renewal cycle. W07 performs outcome recovery before and after the cycle.
- W07 retains all membership, plan, order, payment, MIT mandate, pricing/tax and entitlement authority. W10 never writes D1-01 or D1-04.
- Renewal cycles remain identified and deduplicated by W07's stable D1-04 cycle ID, CAS lease and payment/provider idempotency keys.

The workflow transport is defined in `contracts/transport/W10-W07-membership-renewal-workflow.v1.json`.

## Activation and topology

- `MEMBERSHIP_RENEWAL_ENABLED` defaults to `false` in both W10 and W07.
- W07 accepts this internal batch only from the W10 transport identity, without Authorization/Cookie headers.
- The current activation guard permits Demo pricing and Hyperswitch sandbox only. It does not authorize production MIT charges.
- W07 has no Cron Trigger or Queue binding for renewals.
- No AUTH-013 Queue is reused; no Worker, D1 database or Queue is created. The existing W10 Worker gains one Workflow resource and one W10→W07 Service Binding.
- Deployment, remote migration, live charge and sandbox end-to-end acceptance remain separate explicit gates.

## Worker boundary

- W10 executes asynchronous/background work under the authority of the owning Worker and approved Task/Workflow contract.
- W10 does not receive an artificial Primary Task.
- W10 does not become a second owner of business state merely by executing a job.
- External market/IP ownership is not inferred from a historical path name.

## D1-03 execution schema source admission

The six W10 execution-record entities (Job, Retry, DLQ, ExecutionInbox, ExecutionOutbox and OperationalIdempotency) now have a schema-only source contract and migration slice.

- W10 remains the logical owner of those execution records; W09 remains the sole D1-03 Wrangler migration-configuration owner.
- The D1 migration source is in the existing W09-owned D1-03 migration sequence. The PostgreSQL 18 translation and disposable local rehearsal are under the W10 schema tooling.
- This source admission does not add a W10 D1_03 runtime binding or Queue binding. W10 does not yet read or write these tables at runtime.
- Domain-local business outbox/inbox/idempotency and all business-state writes remain with their owning Workers. Raw event/job payloads and credentials are excluded.
- W06 Appeal and W11 Campaign/GrowthOperation schema sources remain separate blockers. Generic JOB-001..008 runtime admission is not implied.
