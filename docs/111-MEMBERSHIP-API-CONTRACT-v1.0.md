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
