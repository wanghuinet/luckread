# LUCKREAD Blueprint Enhancement — Batch 05

## Status
CLOSED / CONTRACT-FIRST READY

## Unified money and entitlement model
All monetization paths converge on one financial authority:
`Product -> Order -> Transaction -> Entitlement -> Revenue Split -> Ledger -> Settlement -> Audit`

No creator, content, IP, advertising, commerce or task domain may create a parallel wallet, ledger or settlement authority.

## Feature IDs
- MONETIZATION-001 Product and offer catalog
- MONETIZATION-002 Price and pricing policy
- MONETIZATION-003 Order lifecycle
- MONETIZATION-004 Transaction lifecycle
- MONETIZATION-005 Content purchase entitlement
- MONETIZATION-006 Subscription / membership entitlement
- MONETIZATION-007 Creator reward entitlement
- MONETIZATION-008 Task / incubation reward
- MONETIZATION-009 Live gift / tipping
- MONETIZATION-010 Affiliate / commerce attribution
- MONETIZATION-011 Brand collaboration compensation
- MONETIZATION-012 IP licensing transaction
- MONETIZATION-013 Revenue split rules
- MONETIZATION-014 Immutable ledger
- MONETIZATION-015 Wallet / balance projection
- MONETIZATION-016 Settlement and payout
- MONETIZATION-017 Refund
- MONETIZATION-018 Chargeback
- MONETIZATION-019 Dispute and resolution
- MONETIZATION-020 Tax / payout profile
- MONETIZATION-021 Financial reconciliation
- MONETIZATION-022 Financial audit and traceability

## Canonical lifecycle
`DRAFT -> PENDING -> ACTIVE -> COMPLETED`
with exception paths for `DISPUTED -> RESOLVED/CANCELLED`, plus explicit refund/chargeback transitions.

A successful payment does not itself authorize arbitrary content. The transaction must produce the defined entitlement, and access checks must resolve that entitlement through the canonical authorization path.

## Entitlement
Entitlements may represent access to:
- paid article sections
- full articles
- video or media
- subscription tiers
- creator membership perks
- live events or replays
- courses or other digital products
- commerce benefits
- licensed IP usage rights where applicable

Entitlement has owner/resource/scope, status, validity window, source transaction and audit linkage.

## Revenue split
Revenue allocation is declarative and versioned. It may include creator, organization/MCN, IP rights holder, platform and other contractually valid participants. A split must resolve before settlement and must remain traceable to the originating transaction.

## Ledger
Ledger entries are immutable financial facts. Corrections use compensating entries rather than destructive mutation. Wallet/balance views are projections of ledger state, not independent financial truth.

## Settlement
Settlement converts completed ledger obligations into payout batches. It must support pending, eligible, held, paid, failed and reversed states with idempotency and audit linkage.

## Refund / chargeback / dispute
Refunds and chargebacks must reverse or compensate the affected financial chain and entitlement according to policy. They cannot bypass revenue split, ledger or settlement. Disputes preserve the original transaction and create an auditable resolution path.

## Reconciliation
Every financial result must be traceable:
`order -> transaction -> entitlement -> split -> ledger -> settlement -> payout/audit`

External payment providers are adapters. Provider identifiers must be stored for reconciliation, but provider-specific state must not become the platform's canonical financial model.

## Security invariants
1. No client may directly credit a wallet or ledger.
2. No business domain may mutate immutable ledger history.
3. Settlement is only generated from eligible ledger obligations.
4. Refund/chargeback cannot silently delete earned revenue history.
5. Financial actions require scoped authorization and audit records.
6. Entitlement checks happen server-side before protected content delivery.
7. Duplicate callbacks and retries are idempotent.
8. Money amounts use integer minor units plus explicit currency; no floating-point financial authority.
9. Currency, tax and payout jurisdiction are explicit contract data.
10. Financial records remain portable to standard PostgreSQL and are not coupled to one database vendor.

## 1.0 reuse
Directly reuse the mature 1.0 semantics for licensing, transaction states, revenue split, wallet/ledger, settlement, refund/chargeback/dispute and audit. Do not copy obsolete tables, API paths or old Payload implementation.

## Acceptance
Batch 05 is closed when all monetization capabilities reference these Feature IDs and use the same financial authority. Implementation may proceed only after individual contracts, permissions, state transitions, events, async work and tests are defined.

## Next
Batch 06 — IP / Rights / MCN / IP Incubation / IP Trading Market.
