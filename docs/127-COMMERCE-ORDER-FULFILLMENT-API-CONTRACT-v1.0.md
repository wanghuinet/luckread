# LuckRead Commerce Order / Fulfillment API Contract v1.0

**状态：API-CONTRACT-COMPLETE**

## 1. Principles

Public API exposes stable DTOs only. Payload internals, D1 schema, provider SDK objects and cache keys are never public contract.

## 2. Order

```text
POST /v1/orders/{id}/confirm
POST /v1/orders/{id}/cancel
GET  /v1/orders/{id}/execution
```

## 3. Inventory

```text
POST /v1/inventory/reservations
POST /v1/inventory/reservations/{id}/release
POST /v1/inventory/reservations/{id}/consume
```

## 4. Fulfillment

```text
POST /v1/fulfillments
GET  /v1/fulfillments/{id}
POST /v1/fulfillments/{id}/dispatch
POST /v1/fulfillments/{id}/complete
POST /v1/fulfillments/{id}/retry
```

## 5. Return / After-sales

```text
POST /v1/returns
GET  /v1/returns/{id}
POST /v1/returns/{id}/approve
POST /v1/returns/{id}/receive
POST /v1/returns/{id}/complete
POST /v1/after-sales/cases
```

## 6. Dispute

```text
POST /v1/fulfillment-disputes
POST /v1/fulfillment-disputes/{id}/resolve
```

## 7. Mutation Requirements

All mutations require authentication, authorization, idempotency, expected-version/concurrency protection, stable error codes, request/correlation IDs and audit for sensitive actions.

## 8. Pagination / Filtering

Collection endpoints use cursor pagination and stable sort keys. Sensitive customer data is omitted unless the caller has the required scope.

## 9. Provider Boundary

Provider callbacks enter through a verified adapter and are translated into contract-level commands/events.

## 10. Status

```text
API = COMPLETE
IMPLEMENTATION = PENDING
```
