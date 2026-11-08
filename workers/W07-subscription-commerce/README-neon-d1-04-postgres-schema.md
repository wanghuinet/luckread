# W07 D1-04 — Staged Neon PostgreSQL 18 schema

This directory's D1-04 finance source migrations remain the live Cloudflare D1 compatibility source. The staged Neon target is `luckread_finance`; the W07 Worker continues to use its existing D1_04 binding and UUID until a separate runtime-adapter/cutover change control.

## First bounded PostgreSQL slice

This first slice translates only:

- `0001_order_commerce.sql`: `orders`, `order_lines`, `order_create_idempotency`
- `0002_payment_provider_events.sql`: `payments`, `payment_provider_events`, `payment_provider_event_conflicts`

The PostgreSQL 18 artifact contains **6 tables, 14 explicit indexes, 24 source-semantic triggers, one shared trigger function and zero foreign keys**. It preserves immutable order/payment snapshots, integer minor-unit money, CAS versions, the Order/Payment source state constraints, exact completed-idempotency pairing, provider event first-receipt immutability and payload-hash conflict reconciliation.

The first slice is deliberately not a general finance database. It does not create ledger, entitlement, PaymentIntent, Payload user/media or subscription membership tables. Hyperswitch remains the provider identity for `payments` and `payment_provider_events`; the RevenueCat receipt inbox is a separate provider-owned D1-04 slice documented below.

## Deferred D1-04 source migrations

The following remaining source migrations are deferred to separate bounded PostgreSQL schema slices:

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

The remaining D1-04 slices (`0006` refunds/billing and `0007` payment-method revocation) remain deferred. This PR does not change the reviewed D1-04 remote runner or execute any remote database operation.


## PAY-004 subscription renewal cycles — third D1-04 slice

The additive PostgreSQL migration \`0003_w07_d1_04_renewal_cycles.sql\` translates only source migration \`0004_subscription_renewal_cycles.sql\` and adds:

- \`subscription_renewal_cycles\`: immutable recurring-cycle identity, authoritative pricing snapshot, Order/Payment binding, MIT method/mandate reference, execution lease and provider-outcome synchronization state.
- \`subscription_renewal_scheduler_state\`: one retained scheduler cursor singleton. Its seed row is schema control metadata, not imported user or business data.

This slice adds **2 tables, 4 explicit indexes, 13 source-semantic triggers, one trigger function and zero foreign keys**. Cumulative D1-04 schema after slices 0001–0003 is **10 tables, 22 explicit indexes, 49 triggers, three trigger functions and zero foreign keys**.

Important invariants preserved:

- A cycle starts only in \`AWAITING_PRICING\`; the offer and resolved pricing snapshots become immutable.
- A cycle cannot bind to an Order, OrderLine or Payment whose customer, plan, interval, currency, amount or cycle boundaries differ.
- \`PAYMENT_READY\` and \`SUBMITTING\` require a provider-confirmed ACTIVE mandate joined to the same customer's saved payment method.
- \`SUBMITTING\` requires a lease token and expiry; version CAS and strictly increasing update timestamps protect cycle and scheduler transitions.
- Provider-confirmed terminal cycle outcomes precede subscription-outcome synchronization. D1-04 never grants entitlements; subscription authority remains D1-01.
- W07 remains the D1-04 business authority. W10 is orchestration-only and does not read/write D1-01 or D1-04.
- Cycle and scheduler audit/control records are retained; the scheduler seed is restored by rollback while all business fixture rows return to zero.

The PostgreSQL 18.6 rehearsal applies the two already-admitted predecessor slices before PAY-004, runs the complete offline D1-04 source regression suite, checks the cumulative catalog, exercises positive and negative state-machine cases, and confirms rollback. Workflow evidence is recorded in the cumulative schema contract.

At the time PAY-004 was introduced, RevenueCat, refunds/billing and payment-method revocation were still separate pending source slices. Each was translated and rehearsed independently in later PAY-005, PAY-006 and PAY-007 sections below. No remote Neon DDL, Cloudflare D1 write, business data import or production cutover is authorized.


## PAY-005 RevenueCat Webhook inbox — fourth D1-04 slice

The candidate PostgreSQL migration \`0004_w07_d1_04_revenuecat_webhook_inbox.sql\` translates only source migration \`0005_revenuecat_webhook_inbox.sql\` and adds:

- \`revenuecat_webhook_events\`: one immutable first receipt per \`app_id + event_id\`, with bounded object-only \`event_data_json\`, payload SHA-256, lifecycle state and processing timestamp.
- \`revenuecat_webhook_event_conflicts\`: a separate record for each distinct conflicting incoming payload hash, tied to the first receipt and retaining occurrence count and first/last-seen timestamps.

This slice adds **2 tables, 3 explicit indexes, 7 source-semantic triggers, one trigger function and zero foreign keys**. Cumulative D1-04 schema target after slices 0001–0004 is **12 tables, 25 explicit indexes, 56 triggers, four trigger functions and zero foreign keys**. The PAY-005 local PostgreSQL 18.6 rehearsal passed; its evidence is recorded in the cumulative schema contract.

Important invariants:

- \`UNIQUE(app_id,event_id)\` protects the first RevenueCat receipt; replays cannot replace it.
- A conflict must reference the matching immutable first receipt and a distinct valid incoming payload hash.
- Repeated conflicting payloads update only their conflict occurrence record; occurrence_count advances exactly one and last_seen_at never moves backwards.
- Receipt identity and payload are immutable. A receipt is fully immutable once state leaves \`RECEIVED\`.
- Event receipts and conflict records are retained for reconciliation.
- RevenueCat remains separate from Hyperswitch-only \`payment_provider_events\`; the existing provider constraint is not weakened.
- No \`raw_body\`, \`subscriber_attributes\`, PAN/CVC, API keys, browser client secrets, credentials, entitlement or ledger tables are added.
- W07 remains D1-04 business authority. This schema stores RevenueCat receipts only; it does not apply events to D1-01 entitlements or subscriptions.

The PostgreSQL 18.6 rehearsal applies slices 0001–0004 in order, runs the complete offline D1-04 source regression suite, verifies the cumulative catalog, exercises valid and invalid first-receipt/conflict cases in a rollback-only transaction, and confirms zero business fixture rows remain.

At the time PAY-005 was introduced, refunds/billing and payment-method revocation were still pending independent slices. PAY-006 and PAY-007 are documented below. No remote Neon DDL, Cloudflare D1 write, business data import, runtime binding change or production cutover is authorized.


## PAY-006 refunds and billing documents — fifth D1-04 slice

The PostgreSQL migration `0005_w07_d1_04_refunds_billing_documents.sql` translates only source migration `0006_refunds_billing_documents.sql` and adds:

- `refunds`: HyperSwitch-only refund facts with customer-scoped idempotency, immutable commercial identity, CAS versions, an explicit lifecycle guard and monotonic provider timestamps.
- `billing_documents`: immutable customer invoices and receipts, bound to the exact order snapshot; receipts additionally require the matching succeeded payment.

This slice adds **2 tables, 4 explicit indexes, 9 source-semantic triggers, one trigger function and zero foreign keys**. Cumulative D1-04 schema after slices 0001–0005 is **14 tables, 29 explicit indexes, 65 triggers, five trigger functions and zero foreign keys**.

Important invariants:

- A refund must match a succeeded or partially captured HyperSwitch payment and the same merchant, customer, order and currency.
- Refunds reserve against the captured amount. The PostgreSQL insert guard locks the matched payment row before calculating the sum of non-FAILED refunds to serialize concurrent reservations.
- Customer-scoped idempotency keys are unique. Amount, provider, customer/order/payment identity, reason and request hash are immutable.
- Refund state changes use the source lifecycle transitions, exact one-step version CAS and monotonic provider timestamps. Provider network calls remain outside database transactions.
- INVOICE documents have no payment reference; RECEIPT documents must match a succeeded payment for the exact order/customer/currency/amount.
- Issued document snapshots are immutable and both refund facts and issued billing documents are retained.
- No PAN/CVC, API credentials, raw webhook body, entitlement, ledger, user or media data is added. D1-01 continues to own subscription entitlements.

The PAY-006 workflow applies predecessor slices 0001–0004 in order, runs the full offline D1-04 source regression suite, verifies deterministic generators through PAY-006, applies the new PostgreSQL 18.6 slice, tests valid and invalid refund/document cases, and confirms all business fixtures roll back while the single scheduler control row remains.

PAY-007 now has a separate PostgreSQL translation and local rehearsal workflow; its validation evidence is recorded in the PAY-007 section below. No remote Neon DDL, Cloudflare D1 write, business-data import, runtime binding change or production cutover is authorized.


## PAY-007 payment-method revocation — sixth D1-04 slice

The PostgreSQL migration `0006_w07_d1_04_payment_method_revocation.sql` translates only source migration `0007_payment_method_revocation_requests.sql` and adds:

- `payment_method_revocation_requests`: one durable, one-way request per saved payment method, with customer-scoped idempotency, immutable provider/customer/merchant/token identity, exact one-step version CAS, a guarded lifecycle and retained audit history.
- A replacement for the existing `payment_provider_events_terminal_immutable` trigger, matching the source rule that only a `mandate_active` or `mandate_revoked` first receipt previously marked `RECONCILIATION_REQUIRED` can be replayed to `RECEIVED` with `processed_at` and `outcome_code` cleared. Its original event identity and payload hash remain immutable; `APPLIED`, `REJECTED`, payment events and other event types stay terminal.

PAY-007 adds **1 table, 2 explicit indexes, 7 new source-semantic triggers, one trigger function and zero foreign keys**. It replaces one existing provider-event trigger without increasing its cumulative trigger count. Cumulative D1-04 after all seven source migrations is **15 tables, 31 explicit indexes, 72 triggers, six trigger functions and zero foreign keys**.

Important invariants:

- A revocation request must match the exact saved-method ID, provider, merchant, customer and opaque provider payment-method reference. PostgreSQL enforces this source relationship with a trigger rather than a foreign key, preserving the D1-04 zero-FK contract.
- Only one request may exist per saved-method record; the idempotency key is unique within the customer.
- Request identity cannot be rewritten. Every update must advance version by exactly one and use a strictly increasing timestamp.
- `provider_method_deleted_at` is an immutable provider-delete acknowledgement. It does not, by itself, prove that recurring mandates have been revoked.
- `COMPLETED` requires the provider deletion acknowledgement and every mandate attached to the saved method to be `REVOKED`, `FAILED` or `EXPIRED`. Revocation request facts are retained.
- The existing W07 renewal runtime already excludes any active mandate linked to a revocation request whose status is not `COMPLETED`. The PostgreSQL generator fingerprints both `readActiveMandate` and `isExactMandateActive` so a later change cannot silently remove this new-charge block.
- The local request never fabricates provider mandate truth. Only a verified mandate event/reconciliation can make the mandate terminal; D1-01 remains the entitlement authority.

The dedicated PAY-007 PostgreSQL 18.6 rehearsal applies all six predecessor migrations in order, runs the full offline D1-04 source regression suite, checks deterministic generators through PAY-007, tests valid and invalid ownership, idempotency, request transitions, completion, immutable provider deletion time and exact mandate replay cases, then rolls back all business fixtures while preserving the one scheduler control row.

All seven W07 D1-04 source migrations now have isolated PostgreSQL 18 translations. Completing local PAY-007 rehearsal still does **not** authorize remote Neon DDL, shared-ledger remote apply, business-data import, Worker deployment, runtime binding changes or production cutover; those remain separate gates.
