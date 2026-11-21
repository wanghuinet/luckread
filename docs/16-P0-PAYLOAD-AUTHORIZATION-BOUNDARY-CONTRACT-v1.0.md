# P0 Payload Authorization Boundary Contract v1.0

## 1. Purpose

Prevent Payload's internal access controls from becoming a second, conflicting public authorization authority.

## 2. Authority separation

```text
Public API Authorization Contract
        ↓
Central Authorization Decision
        ↓
Domain Command / Query
        ↓
Payload Access Adapter
        ↓
Payload persistence/admin runtime
```

Payload access rules are an enforcement layer, not an independent public API policy source.

## 3. Mandatory invariants

1. Public `/v1/*` authorization is defined by the LuckRead Authorization Contract.
2. Payload Admin UI permissions MUST NOT automatically become public API permissions.
3. A Payload collection `read/update/create/delete` access result MUST NOT be interpreted as a complete business authorization decision.
4. Public API handlers MUST perform the centralized authorization decision before sensitive domain operations.
5. Payload access MUST remain fail-closed.
6. Internal service calls MUST retain actor, subject, scope and correlation context.
7. A Payload admin credential MUST NOT silently bypass public API authorization.

## 4. Two-boundary model

### Boundary A — Public authorization

Checks:

```text
Authentication
Account State
Subject Type
Permission
Scope
Ownership / Grant
Entitlement
Workflow
Business State
Credential
Policy
```

### Boundary B — Persistence enforcement

Payload may additionally enforce:

```text
collection access
field access
document access
admin UI access
```

Boundary B can deny an operation that Boundary A allowed, but Boundary B MUST NOT grant an operation that Boundary A denied.

Therefore:

```text
Final Allow = Public Authorization ALLOW
              AND Payload Enforcement ALLOW
```

## 5. No privilege amplification

Forbidden:

```text
Payload admin = public super_admin
Payload collection access = domain permission
Payload authenticated user = unrestricted API actor
Payload local API = trusted bypass
```

Any internal bypass must use an explicit service-principal contract and be auditable.

## 6. Field protection

Payload field access MUST align with the centralized protected-field registry.

Sensitive fields include at minimum:

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

Generic Payload updates MUST NOT expose these fields to client-controlled mass assignment.

## 7. Local API / internal execution

Payload Local API calls are internal execution mechanisms, not proof of authorization.

Every security-sensitive Local API operation MUST carry:

```text
actor_id
subject_type
organization_scope
permission_context
request_id
trace_id
correlation_id
```

The absence of public HTTP transport MUST NOT remove authorization requirements.

## 8. User status enforcement

Payload may authenticate a user, but account status remains a LuckRead authorization decision.

At minimum:

```text
SUSPENDED
LOCKED
DELETED
```

must not receive protected mutation authorization merely because Payload authentication succeeds.

## 9. Admin UI boundary

Admin UI visibility is presentation/access control for the administrative interface.

It is not a substitute for API authorization.

A hidden button does not constitute security.

## 10. Acceptance matrix

| Scenario | Public Auth | Payload | Result |
|---|---|---|---|
| Valid user, own allowed profile field | ALLOW | ALLOW | ALLOW |
| Valid user, protected field mutation | DENY | ALLOW/UNKNOWN | DENY |
| Suspended user, protected mutation | DENY | ALLOW | DENY |
| Cross-org resource | DENY | ALLOW | DENY |
| Valid scoped admin operation | ALLOW | ALLOW | ALLOW |
| Public auth denied, Payload admin internally available | DENY | ALLOW | DENY |
| Public auth allowed, Payload denies persistence | ALLOW | DENY | DENY |

## 11. CI requirements

The repository MUST eventually prove:

```text
PUBLIC_AUTH_DENY_CANNOT_BE_BYPASSED_BY_PAYLOAD
PAYLOAD_DENY_CANNOT_BE_BYPASSED_BY_PUBLIC_API
LOCAL_API_RETAINS_AUTH_CONTEXT
ADMIN_UI_IS_NOT_PUBLIC_AUTHORITY
PROTECTED_FIELDS_ARE_SERVER_OWNED
SUSPENDED_ACCOUNT_CANNOT_MUTATE
```

## 12. Green rule

```text
PAYLOAD_AUTHORIZATION_BOUNDARY_GREEN
```

requires both contract evidence and executable tests. Documentation alone cannot assert Green.
