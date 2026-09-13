# API Error / Pagination / Cursor Contract v1.0

**Status:** REQUIRED FOUNDATION CONTRACT

## 1. Scope

This contract is mandatory for every public LuckRead API. Business domains MUST NOT invent independent error, pagination, cursor, ordering or list-response conventions.

The machine-readable sources of truth are:

- `contracts/enums/error-code.json`
- `contracts/schemas/common/error.json`
- `contracts/schemas/common/error-response.json`
- `contracts/schemas/common/list-response.json`
- `contracts/schemas/common/pagination.json`
- `contracts/schemas/common/cursor.json`
- `contracts/schemas/common/request-id.json`
- `contracts/schemas/common/trace-id.json`

This document explains those canonical machine contracts. It MUST NOT define a conflicting wire format.

## 2. Error Contract

Canonical public error shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Content not found",
    "details": {}
  },
  "requestId": "req_01J...",
  "traceId": "trace-01J..."
}
```

Required fields are `error.code`, `error.message`, `error.details`, and `requestId`.

`traceId` is optional at the API boundary. When distributed tracing is enabled for the request, the server MUST propagate and return `traceId` using the canonical schema.

`error.code` MUST be one of the canonical values defined by `contracts/enums/error-code.json`. Client behavior MUST depend on the code, not on message text.

HTTP status and semantic error code MUST agree with the operation outcome. Where the caller may not learn whether a protected resource exists, the server MUST use `NOT_FOUND` rather than `PERMISSION_DENIED` in accordance with the canonical security policy.

## 3. Canonical Error Classes

The canonical error vocabulary is the enum in `contracts/enums/error-code.json`, including:

- `UNAUTHENTICATED`
- `PERMISSION_DENIED`
- `INVALID_STATE`
- `PRECONDITION_FAILED`
- `PRECONDITION_REQUIRED`
- `CONFLICT`
- `NOT_FOUND`
- `VALIDATION_FAILED`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_IN_PROGRESS`
- `IDEMPOTENCY_KEY_REUSE_CONFLICT`
- `RATE_LIMITED`
- `QUOTA_EXCEEDED`
- `PAYLOAD_TOO_LARGE`
- `UNSUPPORTED_MEDIA_TYPE`
- `UPLOAD_REJECTED`
- `RESOURCE_LOCKED`
- `INVALID_CURSOR`
- `CURSOR_EXPIRED`
- `DEPENDENCY_FAILED`
- `INTERNAL_ERROR`
- `SERVICE_UNAVAILABLE`

A domain MUST NOT introduce a competing synonym such as `FORBIDDEN`, `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `IDEMPOTENCY_CONFLICT` or `DEPENDENCY_UNAVAILABLE` when an existing canonical error code expresses the same stable client behavior.

## 4. Pagination Contract

Every list endpoint MUST explicitly declare its pagination strategy.

The default strategy is cursor pagination for potentially growing or high-volume collections.

Canonical query parameters are:

```text
cursor
limit
```

Canonical list response envelope is defined by `contracts/schemas/common/list-response.json`:

```json
{
  "data": {
    "items": [],
    "nextCursor": null,
    "hasMore": false
  },
  "requestId": "req_01J...",
  "traceId": "trace-01J..."
}
```

The public API standard is therefore `data.items` + `nextCursor` + `hasMore` + `requestId`, not `data[]` + `meta.next_cursor`.

Default and maximum limits MUST be defined per API family. Servers MUST enforce the maximum. The common maximum is 100 unless a stricter domain contract is declared.

## 5. Cursor Contract

Cursors are opaque to clients. Clients MUST NOT decode or construct cursor contents.

A cursor MUST preserve enough ordering information to continue from a stable position. Cursor semantics MUST remain compatible for the lifetime of the API version.

A cursor MUST be bound to the endpoint, effective query/filter, and deterministic ordering so that a cursor generated for one list context cannot be replayed against a materially different context.

Invalid, malformed, expired or incompatible cursors return the canonical `INVALID_CURSOR` or `CURSOR_EXPIRED` error code as appropriate.

## 6. Ordering

Every cursor-paginated endpoint MUST define deterministic ordering.

Ordering MUST include a stable tie-breaker such as immutable ID when timestamps or ranking scores can collide.

Example:

```text
createdAt DESC, id DESC
```

The ordering contract is part of cursor validity and MUST NOT change silently within the API major version.

## 7. Empty Results

An empty collection is a successful response:

```json
{
  "data": {
    "items": [],
    "nextCursor": null,
    "hasMore": false
  },
  "requestId": "req_01J..."
}
```

It MUST NOT be represented as `404` merely because no list item exists.

## 8. Public API Boundary

Payload-generated REST responses may be used internally. Public APP clients MUST consume the stable LuckRead API contract and MUST NOT depend on Payload document internals.

## 9. Contract Consistency Rules

The following naming is globally canonical:

- `requestId`, never `request_id`
- `traceId`, never `trace_id`
- `nextCursor`, never `next_cursor`
- `hasMore`, never `has_more`
- `data.items`, never `data[]`

Any future change to these names is a versioned API contract decision, not a local domain choice.

## 10. Acceptance Gate

A list API is not admitted unless it defines:

- response envelope;
- canonical error behavior;
- pagination strategy;
- limit/default/max limit;
- cursor semantics where used;
- endpoint/query/order binding for cursor validity;
- deterministic ordering;
- empty-result behavior;
- invalid/expired-cursor behavior;
- contract tests;
- OpenAPI representation that resolves to the same machine-readable schemas.
