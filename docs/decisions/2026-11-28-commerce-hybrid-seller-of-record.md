# Decision: Hybrid Seller of Record for Creator Commerce

- Decision ID: COMMERCE-SELLER-OF-RECORD-2026-11-28
- Status: CONFIRMED PRODUCT DIRECTION / JURISDICTION MATRIX PENDING
- Confirmed by: User
- Repository: wanghuinet/luckread
- Scope: Creator subscriptions and related digital commerce orders

## Decision

LuckRead will use a hybrid Seller-of-Record model. Depending on the creator/merchant's verified legal domicile and business type, the offer category, buyer jurisdiction and applicable law, a transaction may be sold by:

1. LuckRead platform legal entity (PLATFORM_SELLER);
2. Qualified creator/merchant legal entity (CREATOR_MERCHANT_SELLER).

The seller is determined per transaction by a versioned, approved policy. This is not a blanket rule that creator location alone decides the seller.

## Required decision inputs

- Verified merchant legal entity and jurisdiction of registration.
- Merchant type, business type, seller qualification and current compliance status.
- Offer/product/service category and applicable tax classification.
- Buyer billing/tax jurisdiction and transaction currency.
- Marketplace facilitator, deemed-supplier, nexus, registration and collection obligations.
- Payment provider and connector capability for the selected seller model, including connected account, split settlement, refund, chargeback, reserve, negative balance, payout and reconciliation support.

IP address, inferred location, unverified creator profile fields, client-supplied seller IDs and client-supplied tax amounts are not authoritative inputs.

## Deterministic policy requirements

- Every active rule has a stable ID, version, effective interval, jurisdiction scope, eligible merchant types, product categories, seller role, required qualification states, tax provider/profile and PSP route.
- Rule evaluation must return exactly one seller role and one eligible seller identity.
- No match, multiple matches, expired policy, stale qualification, unsupported tax/product jurisdiction or unavailable PSP route returns a stable fail-closed result.
- The resolver must never silently fall back from creator/merchant seller to platform seller, or the reverse.
- Policy changes apply to new orders only; existing orders retain their original immutable seller/tax/fee/processor snapshot.
- Merchant identity and qualification reuse the existing Merchant/Seller authority (contracts 116–123); no duplicate Merchant master is introduced.

## Immutable order snapshot

At minimum, the transaction snapshot references:
- seller role, seller/merchant ID and qualification version;
- seller policy ID/version and the verified jurisdiction inputs used;
- buyer tax jurisdiction and product tax classification/version;
- offer/version, currency, unit/subtotal/discount/tax/total minor units;
- tax provider, tax decision reference and calculation version;
- processor merchant/connected-account reference;
- platform/processor fee policy version, refund/chargeback liability owner and settlement route/version.

Sensitive identity, KYC and tax documents remain controlled references and are never copied into public DTOs or ordinary logs.

## Tax and payment constraints

- Tax must be calculated for the selected seller, buyer location, product classification, nexus/registration and transaction time.
- Synthetic fixed-rate tax and TaxJar Sandbox are test-only. TaxJar's published API scope is primarily US sales-tax calculation with limited international coverage; it is not a universal global VAT/GST engine.
- A production tax provider must be explicitly admitted for each supported jurisdiction/product category and must return a durable calculation reference.
- Hyperswitch's general platform feature set is not proof that a particular connector supports the required marketplace seller model. Connector-specific production capability must be verified.
- No production payment, automatic renewal, tax collection/filing, refund, payout or settlement is authorized by this decision.

## Current implementation consequence

W07 order creation and renewal pricing remain fail-closed unless the complete seller, live price, discount, tax and PSP decisions are admitted. Do not create an order, payment intent, invoice, ledger entry or entitlement on a demo tax result.

## Authority and implementation sequence

- Seller identity/qualification: existing Merchant/Seller authority, contracts 116–123.
- Offer and order: W07 Commerce.
- Payment execution: verified PSP connector through existing W07 integration.
- Ledger and settlement: W68 authority.
- APP/H5/PC: W01 API only.

Before runtime implementation, reconcile the Merchant/Seller contracts' legacy D1 storage references with the current Neon five-database architecture and confirm the existing Worker/database owner. Do not add a Worker, database, Queue, Service Binding or second Merchant authority.

## Required gates before any production enablement

1. Jurisdiction/product seller-of-record matrix reviewed by qualified legal/tax professionals.
2. Platform legal entity or creator/merchant seller onboarding and KYC/KYB completed as applicable.
3. PSP connector capability proven separately for each seller role.
4. Tax provider coverage, product taxability, nexus and durable calculation references admitted.
5. Order snapshot, fee split, refund/chargeback liability and settlement routing contracts admitted.
6. Neon schema/migration and exact-commit tests reviewed.
7. End-to-end payment, refund, dispute, ledger reconciliation and cross-platform tests passed.
8. Separate explicit production enablement approval.

Until all relevant gates pass, unsupported transactions are rejected with no order/payment side effects.