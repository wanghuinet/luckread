# CC-PAY-002-ORDER-ENTITY-MODEL-2026-10-27

**Status: PROPOSED / NOT ADMITTED / NOT GREEN**

## Purpose
This proposal defines only the candidate data model for PAY-002. PAY-002 remains UNRESOLVED and the payment/revenue inventory remains NOT_GREEN.

## Authority reused
- `docs/09-D1-DOMAIN-MASTER-v1.0.md`: D1-04 owns Order and commercial/financial facts; D1-01 remains subscription/access authority.
- `docs/65-MONETIZATION-COMMERCE-SYSTEM-CONTRACT-v1.0.md` and `docs/68-WALLET-LEDGER-AND-SETTLEMENT-CONTRACT-v1.0.md`: order/payment flow and immutable ledger boundary.
- `docs/191-L5-L6-MEMBERSHIP-COMMERCE-ADVERTISING-WALLET-LEDGER-INSTANCE-REGISTRY-v1.0.md`: existing `commerce-order-create-01` and `payment-intent-create-01` instances.
- `docs/305-CONCURRENCY-ETAG-CONDITIONAL-REQUEST-AND-IDEMPOTENCY-CONTRACT-v1.0.md`: idempotency and optimistic-concurrency requirements.
- `contracts/transport/worker-d1-access-boundary.v1.json`: D1-04 UUID; display-name preflight remains required.

## Candidate IDs
- `ENT-ORDER`: versioned order lifecycle and server-computed amount snapshot.
- `ENT-ORDER-LINE`: immutable priced item/version line.
- `contracts/state-machines/order.json`: candidate lifecycle with payment confirmation guard.
- Seller identity and qualification are references to the existing Merchant/Seller authority in docs/116–123; this proposal does not create a second Merchant entity.

Both entities remain PROPOSED and their field/persistence contracts remain CONTRACTED_NOT_VERIFIED. This does not make PAY-002 green.

## Hybrid Seller-of-Record decision (confirmed product direction; policy matrix pending)
The product decision is hybrid: each transaction is assigned to either the platform legal entity or the qualified creator/merchant legal entity using an approved, versioned jurisdiction policy. Creator domicile and business type are inputs, not a sufficient legal decision by themselves. The policy must also evaluate buyer billing jurisdiction, offer/product tax classification, merchant qualification, marketplace-facilitator/deemed-supplier rules, nexus/registration, and provider capability.

The immutable order/transaction snapshot candidate must reference:
- seller role (PLATFORM_SELLER or CREATOR_MERCHANT_SELLER), seller/merchant identity and qualification version;
- seller policy id/version and the jurisdiction facts used by the decision;
- buyer tax jurisdiction, product tax category/version, currency and immutable offer/price version;
- discount and tax decision/provider references, calculation version and integer minor-unit amounts;
- processor merchant/connected-account reference, refund/chargeback liability owner and settlement route/version.

Do not copy raw KYC/tax documents into order snapshots. Store controlled evidence references only. No seller policy match, ambiguous match, expired qualification, unsupported tax/product jurisdiction, or unverified PSP route means fail closed before order persistence/payment side effects. No implicit fallback from creator seller to platform seller or vice versa.

The existing Merchant/Seller contracts (116–123) remain the identity and qualification authority. Their legacy D1 storage wording must be reconciled with the approved Neon five-database architecture before implementation; this change control does not authorize D1 access, remote DDL, or a new database.

## Invariants
1. Customer identity, seller identity/qualification, item prices, discounts and tax decisions are server-derived, not client-authoritative.
2. Money uses integer minor units and explicit currency; total = subtotal - discount + tax.
3. Order + lines + initial idempotency record commit in one Neon D1-04 finance-domain transaction; provider network calls stay outside it.
4. Seller, offer, tax and fee policy versions used by a transaction are immutable in its snapshot.
5. Every mutable transition uses version compare-and-set; no Last-Write-Wins.
6. D1-04/Neon payment and financial authority and D1-01 subscription/access authority remain distinct; no distributed transaction.
7. Refund/reversal is separate from destructive modification of ledger facts.

## Not included
- No runtime route, provider SDK, Worker, D1, Queue or Service Binding is added.
- No migration file is created or executed.
- No deployed schema or production evidence is claimed.
- No canonical API operation, DTO or permission ID is invented.
- PAY-001/002 remain blocked until the evidence chain is admitted.

## Next gates
1. Admit Order API/DTO, operation policy and W01-to-W07 boundary.
2. Confirm the D1-04 display name through read-only remote inventory before preparing a migration.
3. Review physical schema, idempotency and version-CAS design.
4. Execute pricing, replay, key-conflict, cancellation/payment race, authorization, concurrency, recovery and reconciliation tests.
5. Register exact-commit Evidence Registry evidence and rerun PAY-002 mapping gates.
