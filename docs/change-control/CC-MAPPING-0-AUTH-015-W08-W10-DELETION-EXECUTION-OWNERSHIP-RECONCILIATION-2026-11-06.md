# CC-MAPPING-0-AUTH-015-W08-W10-DELETION-EXECUTION-OWNERSHIP-RECONCILIATION-2026-11-06

## Status

`DOCUMENTARY_WORKER_BOUNDARY_RECONCILED / AUTH-015_IMPLEMENTATION_NOT_AUTHORIZED`

## 1. Trigger

`docs/306-DELETION-SEMANTICS-AND-ERASURE-MATRIX-CONTRACT-v1.0.md` previously assigned deletion progression and post-window advancement to W08.

Current authoritative Worker documents assign:
- W08 to T04 Creator / Organization identity relationships and the bounded CASL policy evaluator;
- W10 to asynchronous Queue / Job execution under the authority of the owning Worker/Task;
- W02 as the sole Identity / Account / Authorization authority and D1-01 writer.

The older W08 job wording conflicts with the current Worker Master and the W08 CASL decision.

## 2. Authoritative sources

- `docs/04-WORKER-MASTER-v1.0.md`
- `docs/03-WORKER-BINDING-MAPPING-v1.0.md`
- `docs/change-control/CC-1.1-W08-CASL-POLICY-ENGINE-2026-10-13.md`
- `workers/W10-async/README.md`
- `workers/W10-async/src/index.ts`
- `docs/306-DELETION-SEMANTICS-AND-ERASURE-MATRIX-CONTRACT-v1.0.md`
- `contracts/alignment/mapping-batches/AUTH-015-real-evidence-reconciliation.v1.md`

## 3. Decision

1. W08 is **not** the account-deletion job executor. Its CASL evaluator can evaluate trusted permission context only; it does not own or execute the target entity's lifecycle.
2. W10 is the async execution boundary. It may execute a deletion-related job only after an explicit owning Worker/Task, event/Queue, Workflow/Job, retry, idempotency, audit, and reconciliation contract is admitted.
3. W10 does not become a second business owner and does not directly mutate D1-01 or other target-domain business facts. Its D1-03 writes remain limited to job/execution/idempotency/retry/DLQ/runtime records explicitly assigned by contract.
4. W02 remains the sole authority for account-state decisions and D1-01 account-state writes. A deletion flow cannot write account state through W08 or W10.
5. Each cross-domain effect remains with the owning Worker for that entity/domain. W10 may coordinate execution only through approved transport/Queue/Service Binding contracts; no direct cross-D1 cascade is implied.
6. The old W08 wording in `docs/306` is corrected to state the above boundary.

## 4. Important distinction

This decision resolves the stale **Worker responsibility wording** only. It does not:
- assign AUTH-015 a complete Worker map or populate B01 `workerRefs`;
- authorize an account-deletion or restoration runtime implementation;
- admit the Discovery Draft API candidates or missing request/cancel operations;
- define new entity/field IDs, D1 tables, Queue names, bindings, or public routes;
- prove legal-hold/retention eligibility, deletion, anonymization, or erasure runtime;
- promote AUTH-015, B01, Mapping 0, R4, Evidence Registry, or Five-Way to GREEN.

## 5. Implementation boundary

AUTH-015 remains `BLOCKED_NOT_GREEN` and `implementationAuthorized: false`.

Before any deletion job can be implemented, its owning domain transitions, target Worker contracts, current resource/Queue bindings, legal-hold/retention input, operation idempotency key, replay/compensation behavior, completion verification, and Evidence Registry claims must be admitted. No new Worker, D1, or Queue is authorized by this change.

## 6. Non-changes

- No runtime source changed.
- No D1 migration/query/mutation executed.
- No Worker, D1, Queue, binding, or Workflow resource added.
- No Payload Core change.
- No AUTH-015 implementation or GREEN promotion.
