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
## 6. Runtime Routing

All public `/v1/merchants` and `/v1/stores` routes terminate at W01. W01 authenticates the caller, obtains W08/CASL authorization and forwards the trusted principal/scope to W07 over the existing internal Service Binding. W07 validates ownership and version again and uses the currently admitted production persistence path (D1 during staged migration); Neon finance becomes the production store only after separately approved cutover. No client, APP, H5 or PC code may call W07 internals, Neon or D1 directly. No new Worker or Service Binding is introduced.
