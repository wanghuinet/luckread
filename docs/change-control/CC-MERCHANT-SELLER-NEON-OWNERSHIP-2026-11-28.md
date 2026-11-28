# Change Control: Merchant/Seller Neon Authority Reconciliation

- Change ID: CC-MERCHANT-SELLER-NEON-OWNERSHIP-2026-11-28
- Status: PROPOSED / REVIEW REQUIRED
- Date: 2026-11-28
- Scope: Reconcile Merchant/Seller contracts 116–123 with the approved five-Neon-database and 12-Worker architecture.

## 1. Canonical Authority

- Logical domain: D1-04, Commerce / Financial Authority.
- Sole logical Worker owner: W07.
- Approved PostgreSQL schema target: Neon `luckread_finance`.
- Public API ingress: W01 only.
- Authorization: W08/CASL.
- Asynchronous execution: W10 only through separately admitted existing transport capacity.
- Financial ledger authority remains W68; Merchant/Seller must not own balances or ledger entries.

## 2. Verified Repository Evidence

- The canonical domain master assigns Merchant/Seller to D1-04 and D1-04 to W07.
- The shared Neon schema migration ledger currently records D1-04 runnerStatus=NOT_IMPLEMENTED and remoteApplyReady=false.
- The W07 D1-04 schema manifest currently contains order/payment schema only; Merchant/Seller tables are absent.
- Local PostgreSQL rehearsals and source Wrangler configuration do not prove production deployment, remote schema application, production connection selection, business-data migration or traffic cutover.
- No production cutover evidence is admitted by this change.

## 3. Required Runtime Rule

The approved Neon schema target is not itself production authority. Production persistence authority must be established from deployed Worker version, effective production environment/bindings, actual connection target and a separately approved cutover record. Until those are reconciled, do not claim that D1 or Neon is the active production authority based solely on repository configuration. Preserve the currently admitted production path; do not add a new D1 binding/fallback, second Merchant store or dual-write.

## 4. Scope

This change reconciles contracts only. It does not implement Merchant onboarding/KYB, runtime APIs, schema migrations, remote DDL, seller policy resolver, jurisdiction rule matrix, PSP/tax/payout, deployment, business-data migration or production cutover.

The immediate subscription dependency is limited to a verified Merchant/Seller identity and qualification reference for per-transaction seller policy. The wider Merchant Platform remains implementation-pending.

## 5. Safety Invariants

1. No new Worker, database, Queue, Service Binding or D1 binding/fallback.
2. No direct APP/H5/PC database access; all public traffic enters W01.
3. W07 is the sole Merchant/Seller authority owner.
4. W08 authorization and W07 ownership/qualification enforcement are mandatory and fail closed.
5. No dual-write or second Merchant authority.
6. Raw KYC/tax evidence is not copied into merchant rows, order snapshots, public DTOs or ordinary logs.
7. No remote DDL, production DB mutation, payment, tax collection, payout or deployment is authorized.

## 6. Admission Requirements

- Contracts 116–123 align with D1-04/W07 logical ownership and the Neon schema target.
- W01→W08→W07 routing is confirmed against current transport contracts/configuration.
- D1-04 migration tooling remains blocked until its shared runner is implemented and independently reviewed.
- Exact-commit Contract Admission, Worker boundary, Security Hardening and relevant W07 CI pass.
- Runtime implementation remains blocked until schema/data/API/event contracts and the required migration gates are separately admitted.

## 7. Hybrid Seller-of-Record Relationship

This change supplies only the Merchant/Seller authority prerequisite referenced by the hybrid seller-of-record decision. It does not define jurisdiction-specific legal rules or establish seller qualification. The seller policy resolver must fail closed until a verified Merchant/Seller record, approved policy version, tax decision and PSP route are all available.

## 8. Rollback

Contract-only. Revert this branch if review rejects the ownership mapping. No production rollback is needed.
