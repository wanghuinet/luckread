# LuckRead Merchant / Seller API Contract v1.0

**状态：API-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Endpoints

```text
POST   /v1/merchants
GET    /v1/merchants/:id
PATCH  /v1/merchants/:id
GET    /v1/merchants/:id/qualification
POST   /v1/merchants/:id/qualification
GET    /v1/merchants/:id/stores
POST   /v1/merchants/:id/stores
GET    /v1/stores/:id
PATCH  /v1/stores/:id
GET    /v1/stores/:id/staff
POST   /v1/stores/:id/staff/invitations
PATCH  /v1/stores/:id/staff/:staffId
GET    /v1/stores/:id/products
GET    /v1/stores/:id/fulfillment
PATCH  /v1/stores/:id/fulfillment
```

## 2. Request Rules

Every mutation requires authentication, explicit merchant/store scope, DTO validation, idempotency key, expected version when concurrent updates are possible, requestId/correlationId and stable error codes.

## 3. Response Rules

Responses expose LuckRead DTOs only. No Payload or external Commerce engine schema may leak through the API.

## 4. Authorization

```text
User
→ Session
→ Merchant Scope
→ Store Scope
→ Role Permission
→ Policy/Risk Check
→ Operation
```

Public endpoints must not expose private merchant evidence or staff information.

## 5. Reliability

Create/update/invite/role/fulfillment mutations must be safe under retries. Pagination uses cursors where collections can grow large.


## 6. Public / Internal Routing and Persistence

APP/H5/PC access Merchant/Seller only through W01 public APIs. W01 invokes W08/CASL and forwards a trusted principal through the existing W01→W07 Service Binding. W07 performs ownership, qualification, version and idempotency checks before persistence. No client-supplied seller/merchant status is trusted. Physical persistence follows the approved D1-04 schema target and separately evidenced production cutover state; this contract does not authorize remote DDL, deployment or production traffic changes.
