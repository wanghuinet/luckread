# P0 Authorization Implementation Audit v1.0

## Audit scope

This audit is the implementation gate after the authorization contracts. It must inspect actual Payload configuration, collection access functions, API handlers, Local API usage and domain commands.

## A. Identity

- [ ] User authentication source is identified.
- [ ] Public API actor is explicitly constructed.
- [ ] Payload admin identity is not reused as public authorization authority.
- [ ] Account status is checked independently of authentication success.

## B. Authorization

- [ ] Every protected endpoint invokes centralized authorization.
- [ ] Authorization decisions include subject type.
- [ ] Organization/tenant scope is checked.
- [ ] Resource ownership or explicit grant is checked.
- [ ] Entitlement does not bypass permission/scope.
- [ ] Quota/rate limit does not grant authorization.
- [ ] Business state is checked after security prerequisites.

## C. Payload boundary

- [ ] Collection access rules exist where persistence protection is required.
- [ ] Payload access cannot amplify public authorization.
- [ ] Public authorization denial cannot be bypassed through Local API.
- [ ] Payload admin access cannot silently grant public API access.
- [ ] Protected fields have server-owned write paths.

## D. Mass assignment

Search implementation for patterns equivalent to:

```text
Object.assign(entity, request.body)
spread request.body into protected entity
unfiltered update(request.body)
client-controlled role/status/owner/scope assignment
```

Each finding must be classified as:

```text
SAFE
FIX_REQUIRED
FALSE_POSITIVE_WITH_EVIDENCE
```

## E. IDOR / cross-scope

For every resource endpoint, test:

```text
same-user resource
other-user resource
same-org resource
other-org resource
missing resource
known-but-forbidden resource ID
```

## F. Privilege escalation

Test at minimum:

```text
USER → CREATOR
USER → MODERATOR
USER → ADMIN
ADMIN → SUPER_ADMIN
CREATOR → IP_OWNER
EDITOR → PAYMENT_OPERATOR
API_CLIENT → ADMIN
SERVICE → USER_IMPERSONATION
```

Every unauthorized transition must DENY.

## G. State escalation

Test:

```text
ACTIVE → SUSPENDED
ACTIVE → LOCKED
ACTIVE → DELETED
ENTITLEMENT ACTIVE → REVOKED
DELEGATION ACTIVE → REVOKED
MEMBERSHIP ACTIVE → REMOVED
```

Authorization must immediately follow authoritative state.

## H. Evidence

Each finding must contain:

```text
file
line/range
endpoint or command
actor
resource
action
expected
actual
severity
remediation
verification
```

No finding may be marked resolved without executable verification.

## Current gate

```text
CONTRACT_AUDIT = READY
IMPLEMENTATION_AUDIT = NOT_YET_EXECUTED
SECURITY_GREEN = BLOCKED
```
