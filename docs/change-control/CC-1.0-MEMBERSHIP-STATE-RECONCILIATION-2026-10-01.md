# Change Control — Membership State Reconciliation — 2026-10-01

- Status: BLOCKED_CONTRACT_CONFLICT
- Scope: reconcile the existing Membership entity lifecycle vocabulary with the existing canonical Subscription state machine before W07 implementation admission.

## Observed contract conflict

contracts/entity/MEMBERSHIP-SUBSCRIPTION-FOUNDATION.v1.json defines the Subscription lifecycle as:

pending, active, grace, paused, canceled, expired

contracts/state-machines/subscription.json defines:

PENDING, ACTIVE, PAST_DUE, CANCELED, EXPIRED

and has no GRACE or PAUSED transitions.

The broader Membership contract also describes grace, pause/resume and recovery semantics, so this is a contract vocabulary/transition mismatch, not a runtime implementation detail.

## Governance handling

No source is silently overwritten and no state is declared canonical by inference. The persistence contract is therefore explicitly BLOCKED_CONTRACT_CONFLICT.

The selected reconciliation must establish one canonical state vocabulary and one transition graph, then update the dependent entity/API/DTO/persistence references consistently.

## Non-changes

No Worker, D1, Task, Payload Collection, migration execution, payment authority or runtime behavior is added by this decision material.

## Admission consequence

W07 Membership runtime admission remains blocked until the lifecycle terms and transitions are reconciled and Contract Admission verifies the resulting graph.
