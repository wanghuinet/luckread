# P0 Authorization E2E Matrix v1.0

**Status:** REQUIRED SECURITY TEST CONTRACT

## Purpose

This matrix proves that authorization fails closed and that legitimate scoped access still works. It is a release blocker for security-sensitive domains.

## Core negative matrix

| Case | Expected |
|---|---|
| Anonymous → protected resource | DENY |
| User A → User B private resource | DENY |
| Organization A → Organization B resource | DENY |
| Creator A → Creator B private resource | DENY |
| User → role mutation | DENY |
| User → account status mutation | DENY |
| User → verified-state mutation | DENY |
| User → entitlement mutation | DENY |
| User → subscription/payment state mutation | DENY |
| User → organization ownership transfer | DENY |
| API key → undeclared scope | DENY |
| OAuth token → undeclared scope | DENY |
| Service → undeclared permission | DENY |
| Expired delegation → protected action | DENY |
| Revoked delegation → protected action | DENY |
| Suspended account → protected mutation | DENY |
| Expired/revoked credential → protected API | DENY |
| Invalid ownership → mutation | DENY |
| Self-approval where prohibited | DENY |
| Resource ID known without access | DENY |
| Protected field injected through PATCH | DENY |
| Cross-tenant analytics access | DENY |
| Cross-tenant media access | DENY |
| Cross-tenant IP access | DENY |
| Cross-tenant audit access | DENY |

## Positive matrix

| Case | Expected |
|---|---|
| Authenticated owner + allowed action + valid state | ALLOW |
| Organization member + matching scoped permission | ALLOW |
| Valid entitlement + matching resource scope | ALLOW |
| Active delegation + matching action/scope/time | ALLOW |
| Developer app + declared scope + authorized subject | ALLOW |
| Authorized moderator + moderation scope + eligible content | ALLOW |
| Authorized publisher + publish permission + approved content | ALLOW |

## State transition tests

Test authorization while these changes occur:

```text
ACTIVE → SUSPENDED
role granted → role revoked
membership ACTIVE → REMOVED
entitlement ACTIVE → REVOKED
delegation ACTIVE → REVOKED
credential ACTIVE → REVOKED
ownership A → ownership B
```

Expected behavior: new authorization decisions reflect the new authoritative state and stale cache cannot create persistent access.

## Concurrency tests

Minimum burst cases:

```text
100 concurrent requests during permission revoke
100 concurrent requests during membership removal
100 concurrent requests during credential revoke
100 concurrent requests during ownership transfer
100 concurrent requests during entitlement expiry
```

No test may produce a persistent unauthorized mutation.

## Evidence requirements

Each execution must record:

```text
commit_sha
contract_sha
test_run_id
case_id
expected
actual
request_id
trace_id
policy_version
result
```

Missing evidence is NOT PASS.

## Release gate

```text
NEGATIVE_AUTH_E2E_GREEN
POSITIVE_AUTH_E2E_GREEN
STATE_CHANGE_AUTH_GREEN
CONCURRENCY_AUTH_GREEN
CROSS_TENANT_GREEN
IDOR_GREEN
```

All applicable gates must pass before `AUTHORIZATION_SECURITY_GREEN` can be asserted.
