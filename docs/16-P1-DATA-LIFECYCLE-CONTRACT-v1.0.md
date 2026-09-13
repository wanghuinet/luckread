# P1 Data Lifecycle Contract v1.0

## 1. Purpose

This contract defines the canonical lifecycle of Luckread data across authoritative records, derived data, object storage, cache, events, backups, and deletion workflows.

It prevents inconsistent deletion, orphaned media, premature purge, accidental resurrection, and loss of required audit evidence.

## 2. Core Invariant

Every persisted resource MUST have an explicit lifecycle policy appropriate to its data class.

The platform MUST distinguish authoritative data from derived, cached, temporary, and audit data.

Deletion MUST be a controlled state transition, not an implicit database delete.

## 3. Data Classes

At minimum, the platform MUST distinguish:

- authoritative metadata/state;
- user/account data;
- content metadata;
- R2/object payloads;
- derived indexes/search data;
- cache entries;
- asynchronous jobs;
- events;
- audit/security evidence;
- backups/snapshots;
- temporary processing artifacts.

Each class MUST define its owner, source of truth, retention, deletion behavior, and recovery semantics.

## 4. Canonical Lifecycle

A resource MAY use the following canonical lifecycle where applicable:

`ACTIVE → ARCHIVED → DELETION_PENDING → DELETED`

A resource MAY support recovery:

`DELETION_PENDING → ACTIVE`

Permanent purge is a separate operation and MUST NOT be conflated with logical deletion.

The actual state machine for each domain MUST be declared by that domain contract.

## 5. Logical Deletion

Logical deletion MUST make the resource unavailable to normal API reads and mutations according to authorization policy.

Logical deletion MUST preserve sufficient identifiers and state needed for reconciliation, audit, legal/retention requirements, and safe recovery.

Clients MUST NOT infer physical destruction merely because an API reports a resource as deleted.

## 6. Deletion Pending and Grace Period

High-risk or user-recoverable resources SHOULD enter `DELETION_PENDING` before permanent purge.

The grace period MUST be explicit and machine-readable.

During the grace period:

- normal public reads MUST be denied;
- unauthorized mutation MUST be denied;
- authorized recovery MAY restore the resource;
- cleanup tasks MUST be idempotent;
- related object-storage cleanup MUST be tracked.

A deletion deadline MUST NOT be silently extended by repeated retries.

## 7. Permanent Purge

Permanent purge MUST be a separate, auditable operation.

A purge MUST define all storage locations and derived systems that require cleanup, including where applicable:

- D1 authoritative rows;
- R2 objects;
- indexes/search projections;
- caches;
- queues/jobs;
- materialized/derived records;
- backup handling;
- event/audit retention exceptions.

Purge MUST be idempotent and safely retryable.

## 8. R2 and Object Storage

When metadata references an R2 object, the lifecycle contract MUST define the relationship between metadata state and object state.

The platform MUST prevent an object from being deleted before all authoritative references that require it are resolved, unless the domain contract explicitly permits that behavior.

Orphan detection and cleanup MUST be supported.

Object deletion SHOULD use delayed/asynchronous cleanup for recoverable resources rather than coupling user-facing requests to long-running physical deletion.

## 9. D1 and Relational Data

D1 records MUST follow the domain lifecycle/state machine rather than relying on ad-hoc `DELETE` statements.

Foreign-key/dependency relationships MUST define whether dependent records are:

- cascaded;
- restricted;
- anonymized;
- retained independently;
- soft-deleted.

Cross-database relationships MUST use stable resource identifiers and reconciliation rather than assuming a cross-database transaction.

## 10. Cache and Derived Data

Caches are derived data and MUST NOT be treated as authoritative state.

Deletion or mutation MUST define cache invalidation behavior.

A stale cache MUST NOT resurrect a logically deleted or access-restricted resource.

Search/index projections MUST be rebuildable from authoritative state where the domain requires recovery from projection loss.

## 11. Events and Jobs

Deletion, restoration, archive, and purge transitions SHOULD emit canonical events.

Cleanup jobs MUST be idempotent and MUST carry enough resource/version information to avoid deleting a newly recreated or transferred resource.

A stale cleanup task MUST verify the current resource version/state before destructive action.

## 12. Restore and Resurrection Protection

Restoration MUST be an explicit authorized operation.

A resource identifier MUST NOT be accidentally resurrected by delayed events, stale caches, retries, or old asynchronous jobs.

If an identifier can be reused, the implementation MUST use generation/version semantics to prevent old work from targeting the new resource.

Prefer immutable resource identifiers where practical.

## 13. Retention and Legal Hold

Each data class MUST define retention requirements before implementation.

Where a legal, compliance, security, or audit hold applies, purge MUST be blocked for the affected evidence/data until the hold is released.

A hold MUST be explicit, auditable, scoped, and access-controlled.

The platform MUST NOT promise immediate physical deletion when retention rules prohibit it.

## 14. Privacy and Account Deletion

Account deletion MUST define treatment of:

- account identifiers;
- authored content;
- ownership relationships;
- organization membership;
- IP relationships;
- comments/reactions;
- media objects;
- audit/security records;
- rewards/financial records;
- notifications and derived data.

Deletion of an account MUST NOT silently destroy rights evidence or another principal's owned resources.

An account deletion workflow MUST be coordinated with authorization, ownership/rights, and audit contracts.

## 15. Backup and Recovery

Backups are not automatically considered deleted when primary data is deleted.

Backup retention and restoration behavior MUST be explicitly defined.

Restoring a backup MUST NOT bypass current authorization, deletion, ownership, account-state, or retention rules.

Restored data MUST pass reconciliation before becoming authoritative.

## 16. Lifecycle Idempotency

Every asynchronous lifecycle operation MUST be idempotent.

Repeated archive, delete, restore, cleanup, or purge requests MUST converge on the same valid state without duplicate destructive side effects.

The Idempotency Contract and Event Contract apply to lifecycle mutations.

## 17. Data Integrity and Reconciliation

The platform SHOULD provide reconciliation checks for relationships across D1, R2, indexes, caches, events, and jobs.

At minimum, reconciliation MUST detect:

- metadata referencing missing objects;
- orphaned objects;
- deleted resources remaining publicly indexed;
- stale cleanup jobs targeting newer versions;
- missing required lifecycle events;
- inconsistent ownership/rights state.

Reconciliation failures MUST be observable and reviewable.

## 18. API Contract

APIs MUST distinguish logical deletion from permanent purge where the distinction is relevant.

Deletion responses MUST use the common error/resource contracts and request identifiers.

Recovery and purge endpoints MUST enforce current authorization, account state, ownership/control, organization scope, and applicable rights.

Bulk deletion MUST define partial-failure and retry semantics.

## 19. Machine-Readable Alignment

Lifecycle state names, retention policy identifiers, deletion reasons, and purge/recovery operations MUST be represented consistently across:

- JSON Schema;
- OpenAPI;
- domain state machines;
- job payloads;
- events;
- implementation DTOs.

Domain documents MUST reference canonical lifecycle vocabulary rather than inventing conflicting state names.

## 20. Acceptance Criteria

- [ ] Every persisted data class has an explicit lifecycle policy.
- [ ] Authoritative and derived data are distinguished.
- [ ] Logical deletion and physical purge are separate.
- [ ] Deletion grace/retention semantics are explicit.
- [ ] R2 cleanup and orphan handling are defined.
- [ ] Cross-D1 relationships do not assume distributed transactions.
- [ ] Cache/index deletion and rebuild behavior is defined.
- [ ] Stale jobs/events cannot resurrect or destroy newer resources.
- [ ] Restore semantics are explicit and authorized.
- [ ] Legal/security retention holds are supported where required.
- [ ] Account deletion does not silently destroy other principals' rights.
- [ ] Backup restoration cannot bypass current policy.
- [ ] Lifecycle operations are idempotent.
- [ ] Reconciliation detects cross-store inconsistencies.
- [ ] Contract CI can validate required lifecycle vocabulary and invariants.
