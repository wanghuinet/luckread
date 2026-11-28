# Change Control: Creator Tier & Founding Offers — 2026-11-29

- Change Control ID: `CC-COMMERCE-TIER-FOUNDING-OFFERS-2026-11-29`
- Status: `CONTRACTED-CANDIDATE / IMPLEMENTATION-IN-PROGRESS / NOT-DEPLOYABLE`
- Parent: `docs/313-CREATOR-COMMERCIAL-ENTITLEMENT-PLATFORM-MASTER-EXECUTION-CONTRACT-v1.0.md`, Phase 2 — Tier & Founding Offers
- Base: `main@23f11d0a75718344ebaf1d039ed75d9fdeeebbb6`
- Branch: `feat/stage2-tier-founding-offers`

## Scope

Deliver one coherent Phase 2 vertical slice across W07 membership-plan authority, W07 order pricing/snapshot, W01 creator-plan API and UI, W06 durable audit, and the existing W07 PostgreSQL migration lineage.

1. Preserve fixed-price plans as the default and backward-compatible mode.
2. Add an explicit `priceMode` of `FIXED` or `FLEXIBLE`. Flexible offers require integer minor-unit `minimumPriceMinor`, `suggestedPriceMinor`, and `maximumPriceMinor`, with `1 <= minimum <= suggested <= maximum <= 2147483647`. Currency remains explicit ISO-4217 uppercase.
3. Keep `priceMinor` authoritative for FIXED offers. Reject flexible-only fields on FIXED offers and reject fixed-only ambiguity on FLEXIBLE offers. Existing fixed-price plan versions are interpreted as FIXED without rewriting historical snapshots.
4. Accept `selectedAmountMinor` only for FLEXIBLE offers at order resolution. It must be a safe integer within the current immutable plan version's inclusive range. Reject client-selected amounts for FIXED offers. The server computes the payable line amount.
5. Persist the selected amount, price mode, range, currency, plan ID and immutable plan version in the OrderLine item snapshot. Never recalculate an existing order from a later plan version.
6. Extend creator plan create/update DTO validation, response validation, creator UI and W06 audit payloads consistently. W01 remains the only public API boundary; W07 remains plan/pricing authority.
7. Implement bounded founding-offer capacity and a database-serialized reservation lifecycle in W07's existing membership database. Reservation expiry/compensation must be idempotent; no cache counter may be the capacity authority. Do not create a new Worker, database, Queue or Service Binding.
8. Preserve the current W07 D1-01 / D1-04 database separation. Cross-database work must use a recoverable saga with explicit idempotency and compensation; no claim of a distributed transaction.

## Data and API invariants

- `planId + planVersion` remains the immutable definition key.
- Price fields use integer minor units only; no floating-point arithmetic.
- Plan revision is append-only and uses the existing If-Match/version CAS.
- The creator can only mutate plans owned by the W08-resolved creator identity.
- Order pricing is resolved server-side from the active public plan version; the client cannot set currency, discounts, taxes, totals, seller identity, payment state or provider references.
- A flexible amount is an explicit buyer selection, not a client assertion of payment or entitlement.
- A plan version update never changes an existing subscription or order snapshot.
- Founding capacity is serialized in the W07 membership database. A pending reservation has a bounded expiry and stable idempotency identity; payment confirmation must come only from the verified W07 payment path.
- Refund/chargeback capacity-release policy is intentionally NOT decided by this change. No implementation may silently assume that refund or subscription termination restores a consumed founding seat. The policy remains a separate product decision gate. Expired/failed unpaid holds may be released.

## Explicit non-actions

- No production database migration or remote DDL.
- No production deployment, payment, refund, payout or seller/tax-policy activation.
- No changes to Payload Core, W02 identity authority, W03 content authority, W05 social authority, W08 authorization authority, W10 queue topology, or W68 ledger authority.
- No changes to the approved 12-Worker / 5-database / existing Queue + Service Binding topology.
- No stage 1 rework or premature stage 1 unified acceptance.
- No stage 3 entitlement-grant implementation.

## Required tests and evidence

- Fixed-plan create/revise/replay compatibility and historical row mapping.
- Flexible-plan boundary validation: min, suggested, max, below-min, above-max, non-integer, unsafe integer and currency mismatch.
- Fixed offers reject `selectedAmountMinor`; flexible offers require a valid selection.
- Order snapshot records the exact selected amount and plan version and is immutable under later plan revisions.
- Creator ownership, CAS conflict, idempotency replay and W06 audit failure behavior.
- Concurrent reservation attempts at the capacity boundary prove no oversell; duplicate reserve/commit/release requests converge; expired/failed unpaid holds release once.
- Migration applies to an empty PostgreSQL 18 schema and remains compatible with existing plan versions; generated template/source parity is verified.
- Relevant W01/W07 tests, static checks, PostgreSQL 18 rehearsal and PR CI pass on the exact PR head SHA.

## Deployment gate

This change is not deployable until the full test set and exact-head CI pass, review blockers are resolved, migration artifacts are reviewed, and separate seller/tax production admission is satisfied. Merging code does not authorize remote DDL, production cutover, or real payment activation.
