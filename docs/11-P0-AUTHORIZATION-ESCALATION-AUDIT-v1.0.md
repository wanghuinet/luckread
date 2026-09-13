# LuckRead P0 Authorization / Privilege-Escalation Audit v1.0

**Status:** AUDIT COMPLETE / REMEDIATION REQUIRED

**Scope:** Blueprint and current contract documents, with emphasis on authorization, RBAC, ownership, organization/MCN, IP, workflow, developer/open-platform, and account-state boundaries.

## 1. Executive conclusion

The architecture already contains the correct major security concepts: deny-by-default, permission/action authorization, ownership and scope, account-state enforcement, organization boundaries, entitlement, audit, workflow approval, developer scopes, and server-side authorization.

However, the current documents are **not yet sufficient to declare the authorization system escalation-proof**. Several contracts use overlapping authorization vocabulary, and one material inconsistency exists between the P0 identity contract and the broader RBAC/authorization model.

Therefore:

```text
AUTHORIZATION_ARCHITECTURE = DIRECTIONALLY_CORRECT
PRIVILEGE_ESCALATION_PROOF = NOT_YET_PROVEN
SECURITY_GREEN = FALSE
```

## 2. Material findings

### AUTH-01 — Role model inconsistency [HIGH]

The Identity v1 contract currently defines `role` as a v1 enum of `user/admin`, while the RBAC contract lists `user`, `creator`, `editor`, `moderator`, `mcn_admin`, `mcn_editor`, `admin`, and `super_admin`.

Risk: implementation can accidentally treat the User.role field as the complete authorization authority, bypassing scoped permission, organization membership, entitlement, or resource ownership.

Required remediation:
- make User role a platform-level identity attribute only;
- do not use User.role as the sole business authorization source;
- move effective authorization to centralized Permission Resolution;
- define platform roles, organization roles, entitlements, and resource grants separately;
- explicitly prohibit arbitrary client mutation of any authorization binding.

### AUTH-02 — Authorization decision precedence must be frozen [HIGH]

The documents describe many inputs but do not yet freeze one universal decision order.

Required order:

```text
Account State
→ Authentication
→ Subject Type
→ Platform Permission
→ Organization Membership / Scope
→ Resource Ownership / Grant
→ Entitlement
→ Workflow / Approval
→ Business State / Policy
→ Quota / Rate Policy
→ Final Allow / Deny
```

A higher-priority deny must not be overridden by a lower-priority allow.

### AUTH-03 — Explicit deny precedence [HIGH]

The architecture needs an immutable deny rule:

```text
DISABLED / DELETED / LOCKED / SUSPENDED
→ protected action DENY
```

No `admin`, `super_admin`, organization owner, entitlement, API key, or service identity may silently bypass account-security state unless a separate break-glass policy is explicitly defined, independently authorized, time-limited, audited, and never exposed to ordinary clients.

### AUTH-04 — Object-level authorization must be mandatory [HIGH]

Knowing a resource ID must never imply access.

Every protected read/write must evaluate:

```text
subject
+ resource_type
+ resource_id
+ action
+ scope
+ ownership/grant
+ state
```

This applies to User, Content, MediaAsset, Comment, Organization, IP, Subscription, Order, Payment, Audit, DeveloperApp, API Credential, WorkflowTask, and all future resource types.

### AUTH-05 — Cross-tenant / cross-organization isolation [HIGH]

Every organization-scoped query must carry an authorization scope into the data-access boundary.

Forbidden pattern:

```text
query resource by id
then check organization in application code later
```

Required pattern:

```text
authorize(scope, action, resource)
→ scoped data access
→ result
```

This prevents IDOR and cross-MCN data leakage.

### AUTH-06 — Field-level authorization [MEDIUM/HIGH]

Entity-level permission is insufficient for sensitive fields.

The API projection layer must classify fields as:

```text
PUBLIC
PRIVATE
OWNER_ONLY
ORG_SCOPED
ADMIN_ONLY
SYSTEM_ONLY
RESTRICTED
```

Examples that must never be client-editable through generic update APIs:

```text
role
permissions
entitlements
subscription state
account state
verification state
ownership
security credentials
payment authority
moderation decisions
workflow state
```

### AUTH-07 — Mass-assignment protection [HIGH]

Generic PATCH/update endpoints must use explicit allowlists.

Client payloads must never be mapped wholesale onto domain entities.

Required rule:

```text
Public DTO
→ allowed-field mapper
→ domain command
```

Never:

```text
request body
→ spread/merge
→ persistent entity
```

### AUTH-08 — Delegation / impersonation boundary [HIGH]

Delegated access must have:

```text
delegator
delegate
resource scope
allowed actions
valid_from
valid_until
revocable
reason
audit_id
```

Service-to-service calls must not impersonate users without explicit delegated context.

Admin impersonation, if ever introduced, must be read-only by default and separately audited.

### AUTH-09 — Workflow privilege escalation [HIGH]

Approval authority must be checked independently from the ability to create or submit a workflow task.

Required invariant:

```text
initiator != approver
```

for high-risk actions unless a documented policy explicitly permits otherwise.

A user must not approve a transition merely because they can edit the underlying resource.

### AUTH-10 — IP ownership / commercial authority [HIGH]

IP ownership must not be represented as a global role.

Required model:

```text
IP Resource
+ Ownership / Control Relation
+ Entitlement
+ Scope
+ Action
```

Separate:

```text
author
publisher
IP owner
IP controller
licensee
commercial operator
```

A creator must not gain commercial/IP-management authority merely by creating content.

### AUTH-11 — Developer / Partner API privilege boundary [HIGH]

Developer App scope is not equivalent to user authority.

Effective access must evaluate:

```text
Developer App
+ Credential
+ OAuth Scope
+ User Authorization (if delegated)
+ Organization Scope
+ Resource Permission
+ Account State
+ Policy
```

A leaked or over-scoped API credential must not become an implicit platform administrator.

### AUTH-12 — Webhook trust boundary [MEDIUM]

Incoming webhooks from third parties must be treated as untrusted input until signature, timestamp, event identity, replay protection, provider identity, and event schema are verified.

Webhook delivery credentials must not grant arbitrary API authorization.

### AUTH-13 — Service identity boundary [HIGH]

Services/workers/automation must use explicit service principals and permissions.

A service principal must not inherit `admin` merely because it is an internal service.

Required:

```text
service_identity
→ explicit service_permissions
→ explicit resource scope
→ audit
```

### AUTH-14 — Permission cache safety [HIGH]

Authorization decisions must never be cached without an invalidation/version strategy.

Role, membership, entitlement, suspension, revocation, and ownership changes must invalidate or version relevant authorization state.

A stale cache must fail closed for high-risk actions.

### AUTH-15 — Rate limit / quota must not grant authorization [MEDIUM]

The system must preserve:

```text
Permission = can
Entitlement = owns capability
Quota = amount
Rate Limit = traffic control
```

Passing quota/rate-limit checks cannot turn an unauthorized operation into an authorized one.

### AUTH-16 — Error classification must not leak authorization state [MEDIUM]

Public APIs must avoid creating enumeration oracles.

Where resource existence is sensitive, unauthorized callers may receive the contract-defined `NOT_FOUND` rather than revealing that a protected object exists.

### AUTH-17 — Authorization decision auditability [HIGH]

High-risk decisions must produce an auditable authorization decision linked to:

```text
actor
subject
resource
resource_id
action
scope
result
reason
request_id
trace_id
correlation_id
policy_version
```

### AUTH-18 — Security test matrix is missing as a formal admission artifact [HIGH]

A formal authorization E2E matrix must be added before Security Green.

Minimum matrix:

| Scenario | Expected |
|---|---|
| anonymous → protected resource | DENY |
| normal user → another user's private resource | DENY |
| normal user → own editable resource | ALLOW where permitted |
| creator → unrelated creator resource | DENY |
| MCN editor → unrelated organization | DENY |
| MCN editor → permitted org resource | ALLOW where permitted |
| suspended user → protected mutation | DENY |
| disabled user → protected API | DENY |
| expired entitlement → protected capability | DENY |
| valid entitlement + wrong scope | DENY |
| API key → admin-only operation | DENY |
| developer scope missing | DENY |
| valid delegated access → allowed resource | ALLOW |
| expired delegation → resource | DENY |
| initiator → own high-risk approval | DENY where four-eyes applies |
| stale state/version → transition | DENY / CONFLICT |
| guessed resource ID → protected resource | DENY |
| mass-assignment of role/status | DENY |
| webhook without valid signature | DENY |
| revoked credential | DENY |

## 3. Universal authorization invariant

Every protected operation must satisfy:

```text
ALLOW only if

Authenticated
AND AccountStateAllows
AND SubjectTypeAllows
AND PermissionAllows
AND ScopeAllows
AND ResourceAllows
AND PolicyAllows
AND RequiredApprovalAllows
AND BusinessStateAllows
AND CredentialAllows
```

Otherwise:

```text
DENY
```

There is no implicit allow from role name, resource ID, internal network, Payload access, Worker identity, API key, or client capability.

## 4. Forbidden authorization patterns

The following patterns are explicitly prohibited:

```text
if role == admin → allow everything
```

```text
if resourceId exists → allow
```

```text
if request came from internal service → allow
```

```text
if Payload allowed it → public API allowed
```

```text
if client says owner=true → allow
```

```text
if entitlement=true → ignore scope
```

```text
if organization member=true → all organization resources allowed
```

```text
if API key valid=true → administrator
```

```text
if UI hides button → authorization satisfied
```

```text
if cached decision=true → ignore current account suspension/revocation
```

## 5. Required remediation before Security Green

1. Freeze the unified Authorization Decision Contract.
2. Resolve the `User.role=user/admin` vs broader RBAC role-model inconsistency.
3. Add explicit account-state deny precedence.
4. Add centralized scope/ownership/resource authorization rules.
5. Add field-level authorization classification.
6. Add mass-assignment protection contract.
7. Add delegation/impersonation contract.
8. Add service-principal contract.
9. Add authorization cache invalidation/version contract.
10. Add the authorization E2E/security matrix.
11. Add negative tests for IDOR, cross-organization access, privilege escalation, stale permissions, and role/status mass assignment.
12. Link every high-risk authorization decision to Audit.

## 6. Audit result

```text
Authorization model direction: PASS
Deny-by-default: PASS
Ownership/scope concept: PASS
Account-state concept: PASS
Organization isolation concept: PASS
Workflow approval concept: PASS
Developer scope concept: PASS
IP scoped authority concept: PASS

Role-model consistency: FAIL
Universal decision precedence: INCOMPLETE
Field-level authorization: INCOMPLETE
Mass-assignment contract: INCOMPLETE
Delegation contract: INCOMPLETE
Service-principal contract: INCOMPLETE
Authorization E2E matrix: INCOMPLETE
Privilege-escalation proof: FAIL
Security Green: BLOCKED
```

## 7. Admission rule

No authorization implementation is considered production-ready until the remediation items are contractually landed and the negative authorization/security test matrix passes on the current Git SHA.
