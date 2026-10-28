# CC-PAY-001 — Payment Fact Entity and Webhook Inbox

Date: 2026-10-28

## Decision
Establish the first executable persistence candidate for PAY-001 under the existing W07 / D1-04 payment authority. Reuse the existing server-only Hyperswitch adapter and webhook signature/status validators; do not add another payment gateway abstraction, Worker, D1, Queue, Service Binding, public route, or dependency.

## Authority and boundaries
- W07 owns Payment and payment-provider event ingestion facts in D1-04.
- Order and its immutable commercial snapshot stay in D1-04; payment creation must reference an owned, positive, payable Order with exactly matching amount and currency.
- Subscription and entitlement authority remain D1-01. Provider webhook handlers must not grant entitlement directly.
- Provider calls stay outside D1 batch transactions. Payment creation uses a persisted stable payment ID and idempotency key for retries.
- Only an authenticated and cryptographically verified Hyperswitch webhook may enter the provider event inbox. Raw webhook bodies, client secrets, API keys, card data, and access/entitlement snapshots are not stored.
- Event IDs are unique per provider + merchant. Replays with the same ID and payload hash are idempotent; the same ID with a different hash requires reconciliation, never a second financial transition.
- Event timestamps and local compare-and-set version are used to prevent stale provider events from regressing payment state.

## Migration and runtime posture
- \`0002_payment_provider_events.sql\` is a source candidate only.
- The migration must be separately reviewed and executed through the protected D1-04 manual migration gate with explicit source SHA, database name, and confirmation.
- No public PaymentIntent API, payment capture, Order confirmation, ledger posting, refund, or entitlement mutation is enabled by this change control alone.
- The existing D1-04 migration and postflight workflow must understand both migration IDs and verify both generations of schema objects.

## Required validation before promotion
- Offline SQLite migration checks for schema shape, owner/order/amount/currency binding, immutable snapshots, CAS/version advancement, duplicate event keys, terminal event immutability, and no physical D1-01 foreign key.
- Unit tests for event signature, merchant/reference/amount/currency checks, event replay and conflict, out-of-order provider updates, and recovery after provider/timeouts.
- Exact-head CI, fresh code review, remote migration/postflight evidence, runtime security negative tests, and Evidence Registry admission.
- Payment success remains untrusted until a signed provider event (or an explicitly admitted provider retrieval reconciliation) is validated and persisted. No entitlement is granted by this slice.
