# LuckRead Content Distribution API Contract v1.0

**状态：API-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Versioning

All public/control distribution APIs use a stable version prefix:

```text
/v1/distributions
/v1/distributions/:id
/v1/content/:id/distributions
```

## 2. Commands

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/distributions` | create distribution intent |
| GET | `/v1/distributions/:id` | read distribution state |
| PATCH | `/v1/distributions/:id` | update permitted planning fields |
| POST | `/v1/distributions/:id/execute` | dispatch |
| POST | `/v1/distributions/:id/pause` | pause target |
| POST | `/v1/distributions/:id/resume` | resume target |
| POST | `/v1/distributions/:id/withdraw` | withdraw |
| POST | `/v1/distributions/:id/replay` | replay failed delivery |
| GET | `/v1/content/:id/distributions` | list target states |

## 3. Mutation Contract

Every mutation requires:

```text
requestId
actorId
session/app scope
resource authorization
idempotencyKey
expectedVersion
validated DTO
stable error code
rate/quota evaluation
audit classification
```

## 4. Rules

- Clients cannot choose an ineligible target.
- Rights/policy checks cannot be bypassed by directly invoking `execute`.
- Execute is asynchronous for multi-target fanout.
- Every response exposes authoritative status plus safe downstream status.
- Provider errors are normalized; internal provider credentials/details are never returned.

## 5. Concurrency

Updates use optimistic concurrency where multiple actors may modify the distribution plan. A stale version returns a deterministic conflict error rather than silently overwriting another plan.

## 6. Pagination

Collection reads use cursor pagination with bounded page size. No unbounded target enumeration is allowed.

## 7. Errors

Minimum classes:

```text
INVALID_REQUEST
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
STALE_VERSION
NOT_ELIGIBLE
RATE_LIMITED
DUPLICATE
DEPENDENCY_UNAVAILABLE
TIMEOUT
PARTIAL_FAILURE
ALREADY_WITHDRAWN
```

## 8. Security

Distribution APIs must not expose Payload internal documents, internal D1 schemas, provider credentials, private moderation details, hidden ranking rules or legal evidence beyond the caller's scope.
