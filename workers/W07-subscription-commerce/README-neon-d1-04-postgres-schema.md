# W07 D1-04 — Staged Neon PostgreSQL 18 schema

This directory's D1-04 finance source migrations remain the live Cloudflare D1 compatibility source. The staged Neon target is `luckread_finance`; the W07 Worker continues to use its existing D1_04 binding and UUID until a separate runtime-adapter/cutover change control.

## First bounded PostgreSQL slice

This first slice translates only:

- `0001_order_commerce.sql`: `orders`, `order_lines`, `order_create_idempotency`
- `0002_payment_provider_events.sql`: `payments`, `payment_provider_events`, `payment_provider_event_conflicts`

The PostgreSQL 18 artifact contains **6 tables, 14 explicit indexes, 24 source-semantic triggers, one shared trigger function and zero foreign keys**. It preserves immutable order/payment snapshots, integer minor-unit money, CAS versions, the Order/Payment source state constraints, exact completed-idempotency pairing, provider event first-receipt immutability and payload-hash conflict reconciliation.

The first slice is deliberately not a general finance database. It does not create ledger, entitlement, PaymentIntent, Payload user/media or subscription membership tables. Hyperswitch remains the provider identity for `payments` and `payment_provider_events`; the RevenueCat receipt inbox is a separate later source migration.

## Deferred D1-04 source migrations

The following existing migrations are deferred to separate bounded PostgreSQL schema slices:

- `0003_saved_payment_methods_mandates.sql`
- `0004_subscription_renewal_cycles.sql`
- `0005_revenuecat_webhook_inbox.sql`
- `0006_refunds_billing_documents.sql`
- `0007_payment_method_revocation_requests.sql`

Do not hand-copy these tables into this first artifact. Each needs a separate owner/source-boundary check and PG18 local rehearsal before it is admitted.

## Generator and verification

- Schema contract: `contracts/database/neon-d1-04-w07-order-payment-schema.v1.json`
- PostgreSQL template: `workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-order-payment-postgres.sql`
- Deterministic generator: `workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-order-payment-postgres-migration.mjs`
- Generated migration: `workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql`
- Disposable PostgreSQL 18.6 rehearsal: `.github/workflows/neon-d1-04-w07-order-payment-postgres-rehearsal.yml`

The CI rehearsal also runs the existing offline SQLite regression suite for the full seven-migration D1-04 candidate set. The PostgreSQL verifier uses fixtures inside a transaction and requires all six tables to be empty after rollback.

## Safety

This is a schema-source and disposable local rehearsal only. It does not connect to Neon, mutate Cloudflare D1, deploy W07, change Worker bindings, import business rows, apply the shared migration ledger, or authorize production cutover. D1-04 remote runner readiness remains NOT_IMPLEMENTED until a separately reviewed shared-ledger runner and release gate are admitted.


## PAY-003 saved payment methods and MIT mandates — second D1-04 slice

The additive PostgreSQL migration `0002_w07_d1_04_saved_methods_mandates.sql` translates only source migration `0003_saved_payment_methods_mandates.sql`:

- `saved_payment_methods`: an internal-only provider opaque reference bound to one Hyperswitch merchant and customer.
- `payment_mandates`: immutable proof of explicit online recurring consent and a provider mandate lifecycle record.

This slice adds **2 tables, 4 explicit indexes, 12 source-semantic triggers, one trigger function and zero foreign keys**. Cumulative D1-04 schema after slices 0001 and 0002 is **8 tables, 18 explicit indexes, 36 triggers, two trigger functions and zero foreign keys**.

Important invariants preserved:

- A saved method requires a matching succeeded customer/merchant-bound Payment and the exact `payment_succeeded` provider event still in `RECEIVED`.
- A provider token cannot be rebound to a different customer.
- Consent type, scope, terms version, source identities and saved token identity are immutable.
- Mandates begin only as `PENDING_PROVIDER_CONFIRMATION`; UI redirect or payment success is not mandate activation.
- State changes require a one-step version advance, increasing local update time and strictly monotonic provider time.
- A provider mandate ID cannot change after it is first recorded.
- `REVOKED`, `FAILED` and `EXPIRED` states cannot be reopened; a revoked mandate cannot be reactivated by a stale event.
- The schema stores no PAN/CVC, API key, browser client secret or raw webhook body.
- No subscription entitlement is written here; subscription authority remains in D1-01.

The local PostgreSQL 18.6 workflow applies the already-admitted first slice, runs its predecessor postflight, applies PAY-003, exercises positive and negative lifecycle cases in rollback-only transactions, and confirms zero fixture rows remain.

The remaining D1-04 slices (`0004` renewal cycles, `0005` RevenueCat inbox, `0006` refunds/billing, and `0007` payment-method revocation) remain deferred. This PR does not change the reviewed D1-04 remote runner or execute any remote database operation.
