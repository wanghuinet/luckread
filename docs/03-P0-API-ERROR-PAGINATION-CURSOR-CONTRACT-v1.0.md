# API Error / Pagination / Cursor Contract v1.0

**Status:** REQUIRED FOUNDATION CONTRACT

## 1. Scope

This contract is mandatory for every public LuckRead API. Business domains MUST NOT invent independent error, pagination, cursor, ordering or list-response conventions.

## 2. Error Contract

Standard error shape:

```json
{
  "error": {
    "code": "CONTENT_NOT_FOUND",
    "message": "Content not found",
    "details": {},
    "request_id": "...",
    "trace_id": "..."
  }
}
```

Required fields: `code`, `message`, `request_id`.

`trace_id` is required when distributed tracing is available.

Error codes are stable machine-readable identifiers. Client behavior MUST depend on `code`, not message text.

HTTP status and semantic error code MUST agree with the operation outcome.

## 3. Minimum Error Classes

Domains MUST reuse these classes where applicable:

- `VALIDATION_ERROR`
- `AUTHENTICATION_REQUIRED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `INVALID_STATE`
- `INVALID_CURSOR`
- `RATE_LIMITED`
- `IDEMPOTENCY_CONFLICT`
- `DEPENDENCY_UNAVAILABLE`
- `INTERNAL_ERROR`

A domain may add a specific code only when a generic code cannot express stable client behavior.

## 4. Pagination Contract

Every list endpoint MUST explicitly declare its pagination strategy.

Default strategy is cursor pagination for potentially growing or high-volume collections.

Canonical query parameters:

```text
cursor
limit
```

Canonical response metadata:

```json
{
  "meta": {
    "next_cursor": "...",
    "has_more": true
  }
}
```

Default and maximum limits MUST be defined per API family. Servers MUST enforce the maximum.

## 5. Cursor Contract

Cursors are opaque to clients. Clients MUST NOT decode or construct cursor contents.

A cursor MUST preserve enough ordering information to continue from a stable position. Cursor semantics MUST remain compatible for the lifetime of the API version.

Invalid, malformed or incompatible cursors return `INVALID_CURSOR`.

If cursor expiry is introduced, the expiry behavior MUST be documented and return a stable machine-readable error.

## 6. Ordering

A cursor-paginated endpoint MUST define deterministic ordering.

Ordering MUST include a stable tie-breaker such as immutable ID when timestamps or ranking scores can collide.

Example:

```text
created_at DESC, id DESC
```

## 7. Empty Results

An empty collection is a successful response:

```json
{
  "data": [],
  "meta": {
    "next_cursor": null,
    "has_more": false
  }
}
```

It MUST NOT be represented as `404` merely because no list item exists.

## 8. Public API Boundary

Payload-generated REST responses may be used internally. Public APP clients MUST consume the stable API contract and MUST NOT depend on Payload document internals.

## 9. Acceptance Gate

A list API is not admitted unless it defines:

- response envelope;
- error behavior;
- pagination strategy;
- limit/default/max limit;
- cursor semantics where used;
- deterministic ordering;
- empty-result behavior;
- invalid-cursor behavior;
- contract tests.
