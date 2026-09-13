# P0 Authorization Hardening Contract v1.0

**Status:** REQUIRED SECURITY FOUNDATION

## 1. Objective

Close the remaining privilege-escalation, IDOR, cross-tenant, field-level, delegation and service-principal gaps identified by the authorization audit.

No business domain is considered security-complete until this contract and its negative authorization tests are satisfied.

## 2. Authoritative authorization model

```text
Account State
    ↓
Authentication
    ↓
Subject Type
    ↓
Platform Permission
    ↓
Organization / Tenant Scope
    ↓
Resource Ownership / Explicit Grant
    ↓
Entitlement
    ↓
Workflow / Approval
    ↓
Business State / Policy
    ↓
Quota / Rate Policy
    ↓
ALLOW / DENY
```

A higher-priority security denial MUST NOT be overridden by a lower-level allow rule.

## 3. Mandatory deny precedence

The following conditions are fail-closed:

- unauthenticated protected request;
- DELETED, DISABLED, LOCKED or SUSPENDED account where the action is protected;
- revoked/expired session or credential;
- missing platform permission;
- missing organization/tenant scope;
- failed resource ownership or explicit grant check;
- expired entitlement where entitlement is required;
- failed workflow/approval requirement;
- forbidden business state;
- invalid or exhausted quota where quota is mandatory.

`super_admin`, `admin`, organization owner or developer credentials MUST NOT bypass account security state unless an explicitly audited break-glass policy exists.

## 4. Role model normalization

`role` MUST NOT be the complete authorization model.

The platform distinguishes:

```text
Role
Permission
Entitlement
Subscription
Quota
Organization Membership
Resource Ownership
Resource Grant
Delegation
Account State
```

The legacy Identity v1 `user/admin` role field is treated as a compatibility representation only. New authorization code MUST resolve permissions through the centralized authorization layer rather than adding role-name checks.

## 5. Platform roles

Platform roles are permission groupings. Initial roles may include:

```text
USER
CREATOR
EDITOR
MODERATOR
MCN_ADMIN
MCN_EDITOR
ADMIN
SUPER_ADMIN
```

A role never implies unrestricted access to every resource. Resource ownership, scope, state and policy remain mandatory.

## 6. Organization and tenant isolation

Every organization-owned resource MUST carry enough ownership/scope information to evaluate isolation.

Required conceptual fields:

```text
owner_type
owner_id
scope_type
scope_id
```

For organization resources:

```text
request.organization_scope == resource.organization_scope
```

unless an explicit cross-organization grant exists.

Cross-organization access MUST be denied by default.

## 7. Object-level authorization / IDOR defense

Knowing a resource ID MUST NEVER grant access.

Every object access MUST evaluate:

```text
subject
resource_type
resource_id
action
scope
ownership/grant
state
policy
```

This applies at minimum to:

```text
User
Account
Content
MediaAsset
Comment
Organization
IP
Subscription
Order
Payment
Audit
Analytics
DeveloperApp
```

## 8. Field-level authorization

Public request DTOs MUST use explicit allowlists.

A generic profile/content update MUST NOT permit clients to mutate protected fields such as:

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
created_at
updated_at
```

Server-owned fields MUST be assigned by domain commands.

Mass assignment patterns such as unrestricted object merge from request input are forbidden.

## 9. Ownership is not permission

Ownership can contribute to an authorization decision but does not automatically grant every action.

For example:

```text
content.owner == user
```

may allow `content.update`, but does not automatically allow:

```text
content.publish
content.commercialize
ip.transfer
rights.license
payment.refund
```

Those actions require their own permission/policy checks.

## 10. IP authorization

The following identities remain distinct:

```text
Author
Publisher
IP Owner
IP Controller
Licensee
Commercial Operator
```

IP actions MUST be explicitly scoped:

```text
ip.read
ip.edit
ip.publish
ip.commercialize
ip.license
ip.manage
ip.transfer
```

Creator status alone MUST NOT grant IP ownership or commercial control.

## 11. Workflow separation of duties

High-risk workflow actions MUST enforce separation of duties where policy requires it.

At minimum, the system MUST support checking:

```text
initiator != approver
```

for four-eyes workflows.

A user MUST NOT self-approve a high-risk operation merely because they possess a broad role.

## 12. Delegation

Delegated authority MUST contain:

```text
delegation_id
principal_id
delegate_id
scope
allowed_actions
valid_from
valid_until
status
created_by
revoked_at
```

Delegation MUST be:

- least-privilege;
- time-bounded;
- resource-scoped;
- revocable;
- auditable.

A delegation MUST NOT create broader authority than the principal possesses.

## 13. Service principals

Service-to-service identities MUST have explicit permissions and scopes.

A service MUST NOT silently impersonate an end user.

When delegated user context is required, the request MUST carry auditable:

```text
actor_service
on_behalf_of_user
scope
reason
request_id
trace_id
```

Service credentials MUST NOT be accepted as equivalent to `SUPER_ADMIN`.

## 14. Developer / Partner authorization

Developer applications, API keys and OAuth tokens are separate security subjects.

Effective authorization is the intersection of:

```text
Application Scope
×
User Authorization
×
Organization Scope
×
Resource Permission
×
Account State
```

An API key MUST NOT grant permissions that were not explicitly assigned to the application credential.

## 15. Break-glass access

Emergency administrative access, if introduced, MUST be explicit rather than an implicit admin bypass.

Required properties:

```text
reason
actor
scope
allowed_actions
start_at
expires_at
approval
correlation_id
audit_id
```

Break-glass access MUST expire automatically and MUST be visible in audit records.

## 16. Authorization cache

Permission/authorization caching MUST NOT become an authority that survives security state changes.

At minimum, cache keys must include the relevant subject/scope/version dimensions, and security-sensitive changes MUST invalidate or version-bump affected authorization decisions.

Examples requiring immediate protection include:

```text
account suspension
role change
permission revoke
entitlement revoke
organization membership removal
delegation revoke
credential revoke
```

## 17. Unauthorized response contract

Do not expose sensitive authorization details.

Use the common error registry with stable semantics such as:

```text
AUTH_REQUIRED
FORBIDDEN
NOT_FOUND
```

Resource existence must not be disclosed when policy requires indistinguishable denial.

## 18. Negative authorization test matrix

Every protected domain MUST test at least:

```text
anonymous → protected resource = DENY
user A → user B resource = DENY
org A → org B resource = DENY
creator → unrelated creator resource = DENY
editor → admin-only operation = DENY
user → role mutation = DENY
user → status mutation = DENY
user → entitlement mutation = DENY
user → organization transfer = DENY
service → undeclared permission = DENY
API key → undeclared scope = DENY
expired delegation → DENY
revoked delegation → DENY
suspended account → protected mutation = DENY
expired token → DENY
invalid ownership → DENY
self-approval where prohibited = DENY
```

## 19. Positive authorization tests

Negative tests are not sufficient. Each domain must also prove intended access:

```text
owner + allowed action + valid state = ALLOW
organization role + scoped permission = ALLOW
valid entitlement + valid scope = ALLOW
valid delegation + matching action/scope/time = ALLOW
valid developer scope + authorized user = ALLOW
```

## 20. Concurrency authorization tests

Authorization must remain correct under concurrent requests.

Test at minimum:

```text
permission revoke during request burst
membership removal during request burst
credential revoke during retry
ownership transfer during concurrent mutation
subscription expiry during concurrent entitlement checks
```

A stale authorization result MUST NOT create a persistent privilege escalation.

## 21. Audit requirements

Every security-sensitive authorization decision SHOULD be traceable through:

```text
actor_id
subject_type
resource_type
resource_id
action
scope
result
reason_code
request_id
trace_id
correlation_id
policy_version
```

Administrative grants, revocations, transfers, break-glass actions and permission changes MUST be audited.

## 22. Implementation prohibition

Forbidden patterns include:

```text
if user.role === 'admin'
```

as a standalone authorization decision;

```text
Object.assign(entity, request.body)
```

for protected domain updates;

```text
if apiKeyValid then admin
```

and any authorization based only on possession of a resource ID.

## 23. Security Green Gate

Authorization cannot be marked Green until all required gates pass:

```text
ROLE_MODEL_GREEN
PERMISSION_GREEN
ACCOUNT_STATE_GREEN
SCOPE_GREEN
OWNERSHIP_GREEN
FIELD_AUTH_GREEN
MASS_ASSIGNMENT_GREEN
DELEGATION_GREEN
SERVICE_PRINCIPAL_GREEN
DEVELOPER_SCOPE_GREEN
IDOR_GREEN
CROSS_TENANT_GREEN
WORKFLOW_SOD_GREEN
CACHE_INVALIDATION_GREEN
NEGATIVE_AUTH_E2E_GREEN
POSITIVE_AUTH_E2E_GREEN
CONCURRENCY_AUTH_GREEN
AUDIT_GREEN
```

Final status:

```text
AUTHORIZATION_SECURITY_GREEN
```

requires every applicable gate to be Green. Missing evidence means NOT GREEN.
