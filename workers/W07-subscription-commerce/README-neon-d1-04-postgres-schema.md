# W07 D1-04 — Staged Neon PostgreSQL 18 schema

This directory's D1-04 finance source migrations remain the live Cloudflare D1 compatibility source. The staged Neon target is \`luckread_finance\`; the W07 Worker continues to use its existing D1_04 binding and UUID until a separate runtime-adapter/cutover change control.

## First bounded PostgreSQL slice

This first slice translates only:

- \`0001_order_commerce.sql\`: \`orders\`, \`order_lines\`, \`order_create_idempotency\`
- \`0002_payment_provider_events.sql\`: \`payments\`, \`payment_provider_events\`, \`payment_provider_event_conflicts\`

The PostgreSQL 18 artifact contains **6 tables, 14 explicit indexes, 24 source-semantic triggers, one shared trigger function and zero foreign keys**. It preserves immutable order/payment snapshots, integer minor-unit money, CAS versions, the Order/Payment source state constraints, exact completed-idempotency pairing, provider event first-receipt immutability and payload-hash conflict reconciliation.

The first slice is deliberately not a general finance database. It does not create ledger, entitlement, PaymentIntent, Payload user/media or subscription membership tables. Hyperswitch remains the provider identity for \`payments\` and \`payment_provider_events\`; the RevenueCat receipt inbox is a separate later source migration.

## Deferred D1-04 source migrations

The following existing migrations are deferred to separate bounded PostgreSQL schema slices:

- \`0003_saved_payment_methods_mandates.sql\`
- \`0004_subscription_renewal_cycles.sql\`
- \`0005_revenuecat_webhook_inbox.sql\`
- \`0006_refunds_billing_documents.sql\`
- \`0007_payment_method_revocation_requests.sql\`

Do not hand-copy these tables into this first artifact. Each needs a separate owner/source-boundary check and PG18 local rehearsal before it is admitted.

## Generator and verification

- Schema contract: \`contracts/database/neon-d1-04-w07-order-payment-schema.v1.json\`
- PostgreSQL template: \`workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-order-payment-postgres.sql\`
- Deterministic generator: \`workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-order-payment-postgres-migration.mjs\`
- Generated migration: \`workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql\`
- Disposable PostgreSQL 18.6 rehearsal: \`.github/workflows/neon-d1-04-w07-order-payment-postgres-rehearsal.yml\`

The CI rehearsal also runs the existing offline SQLite regression suite for the full seven-migration D1-04 candidate set. The PostgreSQL verifier uses fixtures inside a transaction and requires all six tables to be empty after rollback.

## Safety

This is a schema-source and disposable local rehearsal only. It does not connect to Neon, mutate Cloudflare D1, deploy W07, change Worker bindings, import business rows, apply the shared migration ledger, or authorize production cutover. D1-04 remote runner readiness remains NOT_IMPLEMENTED until a separately reviewed shared-ledger runner and release gate are admitted.
