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

Both entities remain PROPOSED and their field/persistence contracts remain CONTRACTED_NOT_VERIFIED. This does not make PAY-002 green.

## Invariants
1. Customer identity and item prices are server-derived, not client-authoritative.
2. Money uses integer minor units and explicit currency; total = subtotal - discount + tax.
3. Order + lines + initial idempotency record commit in one D1-04 transaction; provider network calls stay outside it.
4. Every mutable transition uses version compare-and-set; no Last-Write-Wins.
5. D1-04 payment/ledger authority and D1-01 entitlement authority remain distinct; no distributed transaction.
6. Refund/reversal is separate from destructive modification of ledger facts.

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
