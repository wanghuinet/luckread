# Change Control: Merchant/Seller Neon Authority Reconciliation

- Change ID: CC-MERCHANT-SELLER-NEON-OWNERSHIP-2026-11-28
- Status: PROPOSED / REVIEW REQUIRED
- Date: 2026-11-28
- Scope: Reconcile Merchant/Seller contracts 116–123 with the approved five-Neon-database and 12-Worker architecture.

## 1. Reason

The Merchant/Seller contract chain still described Cloudflare D1 as the physical authoritative store, while the current approved runtime has migrated the five logical data domains to Neon PostgreSQL. The canonical domain map places Merchant/Seller under logical D1-04 (Commerce / Financial Authority), and the current Worker ownership map assigns D1-04 to W07. W07 already owns the existing Neon finance database. Leaving the old wording unchanged would invite a new D1 binding, a second Merchant store, or an invalid W07/W01 boundary.

## 2. Decision Proposed

- Logical domain: D1-04 remains the historical domain identifier for Commerce / Financial Authority.
- Physical database: the existing Neon finance PostgreSQL database; no sixth database.
- Sole Worker owner/writer: W07, using its existing runtime and database connection.
- Public API ingress: W01 only; APP/H5/PC never access W07 internal routes or databases directly.
- Authorization: existing W08/CASL boundary, with W07 rechecking trusted merchant/store ownership and qualification before writes.
- Async propagation: existing W10 Queue/workflow boundary; W10 is execution-only.
- Evidence/media: existing approved R2/control store references; raw KYC/tax evidence is not copied into merchant rows, order snapshots, public DTOs or ordinary logs.
- Cache/KV: derived projections only.

## 3. Domain Boundaries

Merchant/Seller remains authoritative for Merchant identity, lifecycle, seller qualification, store ownership, staff/delegation and merchant operating configuration. Commerce remains authoritative for product/offer/order/entitlement. Payment provider remains the external payment execution authority. W68 remains the financial Ledger/settlement authority. Creator, Rights and Risk remain in their existing owners.

W07 may persist Merchant/Seller references and qualification facts in the existing finance database because D1-04 is its assigned domain; it must not become the authority for Creator identity, W02 authentication, W08 authorization, content rights, order fulfilment facts or Ledger balances.

## 4. Scope and Non-Goals

This change only reconciles physical storage and runtime ownership in contracts 116–123. It does not implement Merchant onboarding, KYB/KYC workflows, seller qualification review, Store/Staff UI, runtime APIs, schema migrations, event delivery, tax policy, seller-of-record resolver, payment routing or production operations. Those remain implementation-pending and require their own vertical slices and exact tests.

The immediate subscription dependency is limited to reading a verified Merchant/Seller identity and qualification reference for the per-transaction seller policy. The wider Merchant Platform capability list is not thereby admitted as implemented.

## 5. Safety Invariants

1. No new Worker, database, Queue, Service Binding, D1 binding, D1 fallback or dual-write path.
2. No direct APP/H5/PC database access; all public traffic enters W01.
3. W07 is the only Merchant/Seller authority writer in logical D1-04.
4. Every mutation remains authenticated, authorized, scoped, idempotent, version-checked and audited.
5. Sensitive identity/tax evidence remains in controlled storage and is referenced by opaque identifiers only.
6. Historical D1-04 labels in migration artifacts are lineage identifiers, not live D1 dependencies.
7. No remote DDL, production DB mutation, payment, refund, tax collection, payout or deployment is authorized.

## 6. Required Validation Before Admission

- Contract chain 116–123 is internally consistent with the current Neon five-database mapping and W07 ownership.
- W01 → W08 → W07 routing and the existing W07 service binding are confirmed from current transport contracts/configuration.
- Existing W07 Neon finance schema/migration tooling is reused; no D1 compatibility adapter exists or is added.
- Exact-commit Contract Admission, Worker boundary, Security Hardening and relevant W07 CI pass.
- Implementation remains BLOCKED until the Merchant data/API/event schema and its runtime implementation are separately admitted.

## 7. Relationship to Hybrid Seller-of-Record Decision

This change supplies only the Merchant/Seller authority/storage prerequisite referenced by the hybrid seller-of-record decision. It does not define jurisdiction-specific legal rules or establish that any creator/platform entity is qualified to sell. The seller policy resolver must fail closed until a verified Merchant/Seller record, approved policy version, tax decision and PSP route are all available.

## 8. Rollback / Recovery

This is a contract-only change with no data mutation or deployment. If review rejects the ownership mapping, revert this PR and resolve the Worker/domain owner through the architecture change-control process before any Merchant runtime work. No production rollback is needed.
