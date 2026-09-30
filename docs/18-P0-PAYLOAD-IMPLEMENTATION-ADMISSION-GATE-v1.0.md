# P0 Payload Implementation Admission Gate v1.0

## Status

READY FOR IMPLEMENTATION ADMISSION

## Purpose

Define the minimum executable boundary before Payload implementation is allowed onto `main`.

This gate does not declare implementation complete. It prevents the first Payload implementation from creating a second authorization model, exposing protected fields, or bypassing the Contract-First API boundary.

## 1. Required implementation surface

The first admitted implementation may contain only the minimum foundation required for:

```text
package.json
Payload config
Users collection
Payload adapter/configuration
public API adapter boundary
central authorization adapter
protected-field policy
minimum test harness
CI integration
```

No creator, feed, recommendation, commerce, social graph, MCN or other downstream business domain is admitted by this gate.

## 2. Mandatory source-of-truth rules

```text
OpenAPI / Contract
        ↓
Public API DTO
        ↓
Authorization Decision
        ↓
Domain operation
        ↓
Payload adapter
        ↓
Persistence
```

Payload collection definitions are not allowed to redefine public API semantics.

## 3. User model admission

The implementation MUST distinguish:

```text
Payload admin capability
        ≠
LuckRead SUPER_ADMIN authorization
```

`User.role` may exist for compatibility with Payload authentication/admin behavior, but it MUST NOT be treated as the complete LuckRead authorization model.

The implementation MUST preserve the centralized roles and permissions defined by the authorization contracts.

## 4. Protected fields

At minimum, the following are server-owned:

```text
role
status
verified
owner_id
organization_id
scope_id
entitlements
subscription_state
payment_state
moderation_state
security_state
```

Ordinary client profile updates MUST use an explicit allowlist.

## 5. Public API requirements

Protected `/v1/*` operations MUST have an explicit authorization boundary.

The following are forbidden:

```text
Payload authenticated user → automatic public API allow
Payload admin → automatic public SUPER_ADMIN
collection access → public permission
known document ID → access
Local API call → trusted bypass
request body → unrestricted document update
```

## 6. Payload Access requirements

Payload access rules MUST fail closed where persistence protection is required.

Payload access may deny an operation after public authorization allows it.

Payload access MUST NOT grant an operation previously denied by public authorization.

## 7. Local API requirements

Security-sensitive Local API operations MUST retain authorization context:

```text
actor_id
subject_type
organization_scope
permission_context
request_id
trace_id
correlation_id
```

An internal call without HTTP transport is not inherently trusted.

## 8. Minimum executable tests

Before implementation can be considered admitted, tests MUST cover:

```text
anonymous protected request = DENY
user own allowed profile update = ALLOW
user other-user resource = DENY
user protected field injection = DENY
user role escalation = DENY
user status mutation = DENY
suspended user protected mutation = DENY
cross-organization resource = DENY
Payload admin without public permission = DENY
public authorization ALLOW + Payload deny = DENY
public authorization DENY + Payload allow = DENY
```

## 9. Static implementation checks

CI MUST scan admitted source for at least:

```text
role === "admin" direct authorization
request.body spread into protected updates
client-controlled role/status/owner/scope assignment
unscoped resource lookup followed by mutation
Local API calls without authorization context
public route handlers without authorization boundary
```

False positives require documented evidence and an explicit suppression mechanism. Silent suppression is forbidden.

## 10. Evidence

Implementation evidence must include:

```text
commit_sha
workflow_run_id
test_run_id
case_id
request_id
trace_id
policy_version
expected
actual
result
```

No evidence means the corresponding gate is NOT GREEN.

## 11. Gate states

```text
CONTRACT_ADMISSION_GREEN
IMPLEMENTATION_ADMISSION_GREEN
IMPLEMENTATION_GREEN
E2E_GREEN
SECURITY_GREEN
```

These are independent states.

The following is valid:

```text
CONTRACT_ADMISSION_GREEN = true
IMPLEMENTATION_ADMISSION_GREEN = false
```

The following is invalid:

```text
IMPLEMENTATION_GREEN = true
without executable implementation evidence
```

## 12. Admission decision

Implementation may enter `main` only when:

```text
Contract CI = GREEN
Actions execution = VERIFIED
Payload boundary contract = GREEN
Implementation scope = COMPLIANT
Static authorization scan = GREEN
Minimum authorization tests = GREEN
Evidence artifacts = PRESENT
```

Security Green remains blocked until the full E2E matrix and concurrency tests pass.
