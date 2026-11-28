# LuckRead Membership API Contract v1.0

**状态：API-CONTRACT-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Public API

```text
GET  /v1/membership/plans
POST /v1/membership/plans
GET  /v1/membership/plans/:id
PATCH /v1/membership/plans/:id
POST /v1/membership/plans/:id/retire

POST /v1/membership/subscriptions
GET  /v1/membership/subscriptions/:id
POST /v1/membership/subscriptions/:id/cancel
POST /v1/membership/subscriptions/:id/pause
POST /v1/membership/subscriptions/:id/resume
POST /v1/membership/subscriptions/:id/change-plan

GET /v1/membership/entitlements
GET /v1/creators/:id/membership/plans
GET /v1/creators/:id/membership/members
```

## 2. Mutation Contract

Every mutation requires:

```text
actor
session/app context
scope
requestId
idempotencyKey
expectedVersion
validated DTO
stable error code
rate/quota
```

Client input cannot set `active`, `paid`, `renewed` or equivalent financial assertions directly.

## 3. Error Model

Stable classes include:

```text
MEMBERSHIP_NOT_FOUND
PLAN_NOT_ACTIVE
SUBSCRIPTION_CONFLICT
ENTITLEMENT_NOT_AVAILABLE
VERSION_CONFLICT
FORBIDDEN
RATE_LIMITED
DEPENDENCY_PENDING
INVALID_STATE_TRANSITION
```

## 4. Query Contract

List APIs use cursor pagination and return only caller-authorized records. Subscriber privacy is enforced before projection.

## 5. Idempotency

Subscription creation, cancel, pause, resume and plan change must be idempotent. Reusing an idempotency key with a different semantic request must fail deterministically.

## 6. Boundary

Membership APIs never expose payment provider secrets, raw card data, internal ledger details, Payload internals or D1 schema names.

## 7. Phase 2 Plan Pricing DTO Extension

Creator plan create/update DTOs may include `priceMode`.

- FIXED requests require `priceMinor` and MUST NOT include flexible range fields.
- FLEXIBLE requests require `minimumPriceMinor`, `suggestedPriceMinor`, and `maximumPriceMinor`; all are integer minor units and must satisfy the data contract range invariant.
- Responses return the canonical pricing mode and only the fields applicable to that mode. Historical fixed plans are normalized to `priceMode: FIXED`.
- A checkout request may include `selectedAmountMinor` only for a FLEXIBLE plan. W07 validates the amount against the authoritative current public plan version. FIXED plans reject this field. The client cannot supply price mode, currency, plan version, order total, discount, tax, seller, payment or entitlement assertions.
- W07 persists the accepted selected amount and immutable pricing range in the order-line snapshot. Repricing an existing order is forbidden.

Creator mutations continue to require the existing authenticated W02 principal, W08-resolved creator scope, If-Match/version CAS, Idempotency-Key and durable W06 audit. W01 remains the only public API boundary.


## 8. Phase 2 Founding Member Offer DTO Extension

Creator plan create/update requests may include:

- `offerKind: STANDARD | FOUNDING` (omission on legacy requests means STANDARD).
- `foundingCapacity`: positive integer minor-independent seat count, required only for FOUNDING and null/absent for STANDARD.
- FOUNDING is FIXED-price only. FLEXIBLE + FOUNDING is rejected.
- Once a plan version becomes FOUNDING, subsequent versions MUST preserve offerKind and foundingCapacity; capacity cannot be reset by editing or publishing a new version.
- Public and creator plan DTOs return both fields. W01 validates the W07 response and W06 durably audits the fields on create, update and publish.
- A buyer cannot submit offerKind, foundingCapacity, reservation ID, or seat count. W07 derives them from its immutable current plan version.

Checkout reservation is a W07-owned recoverable saga across the existing Neon D1-01 membership database and D1-04 finance database. W07 reserves a seat before writing the order, stores the reservation ID in the immutable order-line snapshot, then attaches the finance order reference. Only a verified signed success event and finance-confirmed paid order can commit the seat; failed/expired unpaid payments release the hold. The databases are not treated as one transaction.
