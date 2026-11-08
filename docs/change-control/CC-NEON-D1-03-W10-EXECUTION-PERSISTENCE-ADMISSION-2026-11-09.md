# Change Control — Admit W10 D1-03 Async Execution Persistence Source — 2026-11-09

**Decision:** W10-owned execution-record schema source admitted for isolated PostgreSQL 18 rehearsal.
**Scope:** Schema contract, D1 migration source, PostgreSQL-native translation, deterministic generator and local disposable-database verification.
**Not included:** W10 runtime D1 binding, Queue binding, Worker deployment, remote Neon DDL, business-data import or production cutover.

## 1. Authority and ownership

The canonical D1-03 entity owner contract assigns Job, Retry, DLQ, ExecutionInbox, ExecutionOutbox and OperationalIdempotency to W10. W10 has no artificial Primary Task and remains an execution boundary, not a business-state owner.

This admission makes only the six listed W10 execution-record entities physically describable. The original owner Worker continues to own authorization, business mutation and business outcome. Every job must still be admitted under an explicit owner Worker, Task and operation/Workflow contract.

W09 remains the sole D1-03 Wrangler migration-configuration owner. The W10 D1 migration is therefore added to the existing W09-owned D1-03 migration sequence; this does not transfer the W10 entity ownership to W09.

## 2. Source basis

The source fields are bounded by the existing Unified Async Operation Contract (docs/165), Event Delivery/Ordering/Replay/DLQ Contract (docs/163), W10 event-envelope validator, W10 retry classifier, W10 canonical idempotency helper and frozen D1-03 entity-owner map.

The six admitted entity mappings are:

- Job → durable operation record and lifecycle fields.
- Retry → attempt number, failure class, error summary and retry timing.
- DLQ → event identity/metadata, attempt count, failure classification, first/last seen time and replay/discard resolution.
- ExecutionInbox → consumer-scoped event identity, idempotency metadata and processing state.
- ExecutionOutbox → W10-owned event envelope metadata, opaque payload reference/hash and dispatch state.
- OperationalIdempotency → W10 async-operation submission key and request hash mapped to one operation.

## 3. Required boundaries

1. W10 never becomes the authority for the owner Worker's business state.
2. Domain-local outbox, inbox and idempotency records stay in their source D1. The W10 OperationalIdempotency table is only for W10-owned async-operation submission.
3. The W10 DLQ table is a queryable quarantine/evidence record. It does not replace Cloudflare Queue native retry limits or native DLQ configuration.
4. Raw event/job payloads, passwords, access tokens, payment credentials, private messages and unnecessary personal data are not stored in these tables. Event metadata, payload hashes and opaque references are used.
5. Retry and OperationalIdempotency references are same-owner references only. No cross-Worker or cross-D1 foreign key is introduced.
6. D1-05 remains analytics-only. No W11 analytics table is included in D1-03.
7. W06 Appeal persistence remains excluded until a dedicated Appeal persistence contract and source migration are admitted.
8. W11 Campaign and GrowthOperation remain unadmitted in D1-03 until the T22 source/persistence contract is completed. This W10 admission does not close that gap.

## 4. Migration execution boundary

The D1 source migration is placed in the existing W09-owned D1-03 migration directory because W09 remains the sole Wrangler migration-config owner. Its table/record ownership remains W10.

The PostgreSQL 18 migration is generated from the source contract and admitted source inventory. It is tested only against disposable PostgreSQL 18.6. The workflow receives no Neon credentials and cannot mutate Cloudflare D1 or Neon.

## 5. Acceptance

- [x] Six W10 tables match the owner map and source contracts.
- [x] D1 source contains six W10-owned tables, seven explicit indexes and two same-owner foreign keys.
- [x] PostgreSQL 18.6 catalog matches six tables, seven explicit indexes and two same-owner foreign keys.
- [x] Uniqueness, state checks, DLQ metadata and same-owner references are verified.
- [x] Synthetic fixtures are rolled back and every business/execution table returns to zero rows.
- [x] No W10 runtime D1 binding, Queue binding, Worker, D1, Queue, Service Binding or production configuration is added.
- [x] Remote DDL, business-data import and production cutover remain false.

Passing this slice admits W10 schema sources only. JOB-001..008 runtime implementation and global Mapping/Contract GREEN status are not promoted by this change.


## 6. PostgreSQL 18.6 rehearsal evidence

The dedicated local workflow completed successfully:
- Run: [42502495149](https://github.com/wanghuinet/luckread/actions/runs/42502495149)
- Verified head: `93fdce0b5963501ca55d8093c5514828d302a6a4`
- Target: disposable `luckread_d1_03_w10_rehearsal`, PostgreSQL 18.6
- Catalog: 6 tables, 7 explicit indexes, 2 same-owner foreign keys, 0 triggers, 0 trigger functions
- Generator/admission tests, schema apply, catalog validation, idempotency uniqueness check and transaction rollback: PASS
- Synthetic fixture rows after rollback: 0
- Evidence artifact: `13626345587` (`sha256:209f474ce742eb7f647f362b51fb468f3eb0d3a3ba30ac1f2ddc650525d6a7ad`)

This is local disposable-database evidence only. It does not authorize remote Neon DDL, runtime binding/deployment, business-data import or production cutover.
