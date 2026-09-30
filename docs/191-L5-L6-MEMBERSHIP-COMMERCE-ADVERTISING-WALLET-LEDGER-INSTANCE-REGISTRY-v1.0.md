# LuckRead L5/L6 Membership / Commerce / Advertising / Wallet-Ledger Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Membership、Merchant / Seller、Commerce、Advertising、Wallet / Ledger / Settlement 相关现有 L4，并与 65、66、67、68、71、160–176、179、180 建立执行、财务与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Membership / Entitlement Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate membership ID | membership-id-generate-01 | ID unique/non-reused; canonical namespace applied |
| create membership plan | membership-plan-create-01 | plan/version unique; owner scope enforced |
| publish membership plan | membership-plan-publish-01 | approved plan/version published once; policy recorded |
| subscribe membership | membership-subscribe-01 | eligibility/payment state validated; duplicate retry safe |
| activate entitlement | membership-entitlement-activate-01 | activation occurs once; exact plan/version recorded |
| pause membership | membership-pause-01 | pause policy enforced; state durable |
| resume membership | membership-resume-01 | eligible paused state restored deterministically |
| cancel membership | membership-cancel-01 | cancellation semantics/version explicit; future access bounded |
| expire membership | membership-expire-01 | expiration deterministic; stale entitlement rejected |
| renew membership | membership-renew-01 | renewal idempotent; term boundaries correct |
| upgrade membership | membership-upgrade-01 | proration/term policy explicit; resulting entitlement durable |
| downgrade membership | membership-downgrade-01 | future-term semantics explicit; no unauthorized retroactive loss |
| resolve entitlement | membership-entitlement-resolve-01 | current authoritative state returned; scope enforced |
| revoke entitlement | membership-entitlement-revoke-01 | revocation durable; derived access converges |
| refund membership | membership-refund-01 | refund eligibility validated; entitlement consequence deterministic |

## 2. Merchant / Seller / Catalog

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create merchant | merchant-create-01 | merchant ID unique; actor scope verified |
| verify merchant | merchant-verify-01 | verification evidence linked; state durable |
| configure seller profile | seller-profile-config-01 | authorized settings only; version traceable |
| create product | commerce-product-create-01 | product ID unique; ownership/scope enforced |
| create product version | commerce-product-version-01 | version immutable after publication |
| publish product | commerce-product-publish-01 | only eligible version public; policy recorded |
| set product price | commerce-price-set-01 | currency/precision/validity constraints enforced |
| set inventory state | commerce-inventory-state-01 | state transition valid; authoritative source explicit |
| retire product | commerce-product-retire-01 | future sale blocked; historical orders preserved |
| resolve catalog | commerce-catalog-resolve-01 | current eligible catalog returned; restricted items excluded |
| create promotion | commerce-promotion-create-01 | validity window and scope explicit |
| validate promotion | commerce-promotion-validate-01 | eligibility and stacking rules deterministic |

## 3. Order / Checkout / Payment Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create cart | commerce-cart-create-01 | cart ID unique; owner scope enforced |
| add cart item | commerce-cart-add-01 | product/version valid; pricing snapshot semantics explicit |
| remove cart item | commerce-cart-remove-01 | mutation idempotent; cart state durable |
| create checkout | commerce-checkout-create-01 | checkout references exact price/product versions |
| calculate order total | commerce-order-total-01 | currency/rounding/tax/promotion rules deterministic |
| create order | commerce-order-create-01 | order created once; durable order state authoritative |
| reserve inventory | commerce-inventory-reserve-01 | reservation idempotent; oversell protection explicit |
| release inventory | commerce-inventory-release-01 | reservation released safely; replay bounded |
| initiate payment | payment-intent-create-01 | payment intent unique; order linkage canonical |
| confirm payment | payment-confirm-01 | confirmation idempotent; paid state authoritative only after valid provider result |
| handle payment failure | payment-failure-01 | failure durable; retryability/status explicit |
| handle payment callback | payment-callback-01 | signature/authenticity verified; duplicate callback safe |
| cancel order | commerce-order-cancel-01 | cancellation policy enforced; terminal state durable |
| fulfill order | commerce-order-fulfill-01 | fulfillment transition valid; item state traceable |
| complete order | commerce-order-complete-01 | completion terminal state authoritative |
| refund order | commerce-order-refund-01 | refundable amount bounded; ledger effects linked |
| return order | commerce-order-return-01 | return eligibility/state machine explicit |

## 4. Advertising Platform

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create advertiser account | ad-advertiser-create-01 | advertiser identity/scope verified |
| verify advertiser | ad-advertiser-verify-01 | verification evidence linked; state durable |
| create campaign | ad-campaign-create-01 | campaign ID unique; owner scope enforced |
| configure targeting | ad-targeting-config-01 | targeting constraints validated; prohibited targeting rejected |
| configure budget | ad-budget-config-01 | currency/limit/period valid; version traceable |
| create creative | ad-creative-create-01 | creative identity/version unique |
| submit creative review | ad-creative-review-01 | moderation/risk/rights checks linked |
| approve creative | ad-creative-approve-01 | approved version explicit; policy recorded |
| reject creative | ad-creative-reject-01 | reason/policy durable; user-visible state explicit |
| activate campaign | ad-campaign-activate-01 | campaign eligibility validated before serving |
| pause campaign | ad-campaign-pause-01 | serving stops deterministically; spend boundary explicit |
| terminate campaign | ad-campaign-terminate-01 | terminal state durable; future delivery blocked |
| resolve ad candidate | ad-candidate-resolve-01 | only eligible advertiser/creative/campaign returned |
| apply ad frequency cap | ad-frequency-cap-01 | configured cap enforced across defined scope |
| record ad impression | ad-impression-01 | attributable event; duplicate semantics explicit |
| record ad click | ad-click-01 | attributable event; fraud/risk controls applied |
| calculate ad spend | ad-spend-calc-01 | billing inputs/version traceable; deterministic aggregation |
| reconcile ad spend | ad-spend-reconcile-01 | source totals reconciled; discrepancies durable |

## 5. Wallet / Ledger / Settlement

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate wallet ID | wallet-id-generate-01 | wallet ID unique; owner canonical |
| open wallet | wallet-open-01 | owner/scope validated; one authority established |
| freeze wallet | wallet-freeze-01 | frozen state authoritative; restricted operations deterministic |
| unfreeze wallet | wallet-unfreeze-01 | authorization verified; derived access converges |
| create ledger entry | ledger-entry-create-01 | immutable entry ID; double-entry/invariant rules enforced where applicable |
| post ledger entry | ledger-entry-post-01 | posting atomic; no duplicate financial effect |
| reverse ledger entry | ledger-entry-reverse-01 | reversal references original; net effect deterministic |
| hold funds | wallet-hold-01 | hold ID unique; available/balance semantics explicit |
| release hold | wallet-hold-release-01 | original hold linked; duplicate release safe |
| capture held funds | wallet-hold-capture-01 | capture cannot exceed hold; ledger linkage canonical |
| calculate balance | wallet-balance-resolve-01 | derived balance reconciles to authoritative ledger |
| create settlement batch | settlement-batch-create-01 | batch window/scope explicit; deterministic membership |
| calculate settlement | settlement-calc-01 | formula/rate/version traceable |
| validate settlement | settlement-validate-01 | invariants pass before payout |
| execute payout | settlement-payout-01 | payout idempotent; provider result linked |
| handle payout failure | settlement-payout-failure-01 | failure durable; retryability explicit |
| reconcile settlement | settlement-reconcile-01 | external/internal totals compared; discrepancy case created |
| close accounting period | ledger-period-close-01 | period state terminal/controlled; late entries policy explicit |

## 6. Creator / IP Earnings Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| accrue creator earnings | creator-earnings-accrue-01 | earning source/version traceable; no duplicate accrual |
| apply revenue share | creator-revenue-share-01 | share policy/version deterministic |
| reserve payable amount | creator-payable-reserve-01 | reserved amount linked to ledger/order/ad source |
| approve payout | creator-payout-approve-01 | payout eligibility/risk checks complete |
| dispute earnings | creator-earnings-dispute-01 | dispute case linked to exact calculation/version |
| adjust earnings | creator-earnings-adjust-01 | authorized adjustment creates compensating ledger effect |
| reconcile creator earnings | creator-earnings-reconcile-01 | ledger/source totals reconcile; discrepancies auditable |

## 7. Cross-Domain Saga / Refund / Compensation

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create commerce saga | commerce-saga-create-01 | saga ID unique; steps/version traceable |
| execute compensation | commerce-compensation-01 | compensation bounded by completed effects |
| refund and entitlement compensation | refund-entitlement-saga-01 | refund/payment/entitlement transitions converge |
| order-payment reconciliation | order-payment-reconcile-01 | order/payment state mismatch detected and repaired through authority |
| ad spend ledger reconciliation | ad-ledger-reconcile-01 | ad spend and ledger source reconcile deterministically |
| creator payout reconciliation | creator-payout-reconcile-01 | payout and ledger state converge |

## 8. Async / Event / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue billing operation | billing-job-enqueue-01 | unique job key; schema validated |
| retry payment/settlement job | billing-job-retry-01 | retry bounded/idempotent; backoff deterministic |
| dead-letter billing job | billing-job-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay billing event | billing-event-replay-01 | replay cannot duplicate financial effect |
| rebuild commerce projection | commerce-rebuild-01 | derived views rebuilt from authoritative order/ledger sources |
| reconcile entitlement projection | entitlement-reconcile-01 | access state rebuilt from membership authority |

## 9. Cross-Cutting Inheritance

```text
160 Lifecycle / retention / erasure
161 Backup / DR / BCP
162 Schema / migration / backfill
163 Event delivery / ordering / replay / DLQ
164 Saga / compensation / reconciliation
165 Unified async operation
166 Error / state taxonomy
167 Cache / invalidation / hot-key / stampede
168 Scope / tenant / organization isolation
169 Security / secret / key lifecycle / incident
170 Rate / quota / traffic shaping
171 Observability / SLI / SLO / error budget
172 Localization / region / time / currency
173 Accessibility for purchase/payment/creator-finance surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 10. Financial Authority Boundary

- Ledger is the authoritative financial record; wallet balance is a derived or controlled account view reconciled to ledger invariants.
- Order state is authoritative for order lifecycle; payment provider state cannot silently mutate order state without validated callback/reconciliation semantics.
- Membership entitlement is authoritative for access; payment/refund operations must transition entitlement through explicit contract/state rules.
- Advertising delivery metrics are attributable inputs; billing totals require reconciled, versioned aggregation.
- Creator earnings and payouts MUST produce traceable ledger effects; no direct counter mutation may create financial authority.
- Caches and analytics projections MUST NOT become financial authority.

## 11. Readiness

```text
L4 scope = CLOSED
L5 coverage = CLOSED
L6 minimum claims = CLOSED
Contract refs = REQUIRED BEFORE READY
Test refs = REQUIRED BEFORE READY
Evidence = REQUIRED BEFORE PASS
Implementation = NOT AUTHORIZED
CL = NOT RUN
CI = NOT RUN
```

## 12. STOP

- financial effect without unique/idempotent operation identity;
- order marked paid without validated payment authority;
- duplicate callback creates duplicate financial effect;
- ledger entry mutated in place instead of compensating/reversal semantics;
- entitlement granted without valid membership/payment decision;
- expired/revoked membership remains active through cache;
- ad spend or creator earnings bypass ledger reconciliation;
- refund partially completes without explicit compensation state;
- payout proceeds without required validation/risk checks;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
