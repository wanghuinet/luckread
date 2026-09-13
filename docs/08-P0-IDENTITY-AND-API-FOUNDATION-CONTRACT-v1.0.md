# P0 Identity and API Foundation Contract v1.0

**Status:** READY FOR IMPLEMENTATION

**Scope:** User identity/account foundation only. This contract does not implement creator, social graph, feed, recommendation, commerce or other downstream domains.

## 1. Goal

Establish one authoritative identity model that every future API/domain can reference without redefining account, role, status, privacy or audit semantics.

## 2. User authoritative fields

| Field | Type | Required | Authority | Rule |
|---|---|---:|---|---|
| id | Payload ID | yes | Payload/D1 | immutable |
| email | auth email | yes | Payload/D1 | unique, authentication identity |
| username | string | yes | Payload/D1 | unique, 3-32 chars |
| displayName | string | no | Payload/D1 | presentation only |
| bio | text | no | Payload/D1 | presentation only |
| role | enum | yes | Payload/D1 | user/admin for v1 |
| status | enum | yes | Payload/D1 | active/suspended |
| emailVerified | boolean | yes | Payload/D1 | default false; must not grant admin privilege |
| locale | string | no | Payload/D1 | user preference |
| timezone | string | no | Payload/D1 | user preference |
| marketingConsent | boolean | yes | Payload/D1 | default false |
| createdAt | timestamp | yes | Payload/D1 | immutable audit field |
| updatedAt | timestamp | yes | Payload/D1 | managed by Payload |

## 3. Access rules

- Anonymous users may register only through the public registration path.
- Authenticated users may read/update their own profile fields allowed by policy.
- Only admins may change `role` and `status`.
- `emailVerified` is never user-editable through a generic profile update.
- Suspended users cannot perform protected business mutations.
- No future domain may invent an independent user identifier.

## 4. API boundary

The future APP API must expose a stable DTO rather than Payload's internal User document.

Required foundation endpoints/contracts:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/me`
- `PATCH /v1/me`

Exact transport implementation may use Payload auth internally, but Payload internals are not part of the public contract.

## 5. Profile update boundary

User-editable profile fields for v1:

- username (subject to uniqueness/policy)
- displayName
- bio
- locale
- timezone
- marketingConsent

Admin-only:

- role
- status

System-only:

- emailVerified
- timestamps

## 6. Security requirements

- Authentication is required for protected profile operations.
- Authorization is evaluated server-side.
- Sensitive fields are never returned unless explicitly allowed.
- Rate limiting and abuse controls are mandatory for registration/login.
- Request/correlation IDs must exist at the API boundary.
- Login/registration failures must use a stable error model and must not leak account existence unnecessarily.

## 7. Audit requirements

At minimum, audit-sensitive identity changes:

- role change
- status change
- email identity change
- account suspension/reactivation
- privacy/consent change

Audit records must identify actor, target, action, timestamp and correlation/request ID when the operations layer is implemented.

## 8. Cost requirements

- Do not introduce a Worker/database write for every read.
- `/v1/me` may be cache-assisted only if invalidation cannot create stale authorization decisions.
- Authentication and authorization remain authoritative; cache cannot override account suspension or role state.

## 9. Acceptance criteria

1. Existing Payload login remains functional.
2. User records contain the contract fields with safe defaults.
3. Non-admin users cannot change role/status.
4. `emailVerified` cannot be changed through ordinary user profile updates.
5. Suspended users cannot perform protected mutations.
6. Typecheck passes.
7. Payload local development starts successfully.
8. Migration/schema generation succeeds for the configured D1 adapter.
9. No Payload core source is modified or copied.
10. The implementation does not add downstream business domains.

## 10. Implementation boundary

Implementation is limited to the Users collection and the minimum API adapter required for this contract. Creator, social, feed, risk scoring, recommendation and commerce are separate contracts.
