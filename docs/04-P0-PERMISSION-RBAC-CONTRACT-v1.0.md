# Permission / RBAC Contract v1.0

**Status:** REQUIRED FOUNDATION CONTRACT

## 1. Scope

All business permissions MUST use this contract. Business domains MUST NOT implement independent role systems or scattered role-name checks.

## 2. Authorization Model

```text
User / Service Principal
        ↓
      Role
        ↓
   Permission
        ↓
 Resource + Action
        ↓
   Access Decision
```

A permission is expressed as a stable resource/action pair, for example:

```text
content.read
content.create
content.update
content.publish
ip.read
ip.create
ip.update
ip.verify
creator.manage
comment.moderate
```

## 3. Roles

Initial roles may include:

- `user`
- `creator`
- `editor`
- `moderator`
- `mcn_admin`
- `mcn_editor`
- `admin`
- `super_admin`

Roles are configuration/groupings of permissions. APIs MUST authorize against permissions and resource ownership/context, not merely role names.

## 4. Scope and Ownership

A permission decision MAY depend on:

- authenticated identity;
- role;
- resource ownership;
- creator relationship;
- organization/MCN membership;
- resource state;
- moderation state;
- explicit delegation.

Example:

```text
content.update
AND owner == current_user
```

or:

```text
content.publish
AND current_user has publishing authority for creator
```

## 5. Payload Boundary

Payload Access Control remains the CMS-level enforcement mechanism where applicable.

The application contract is authoritative for public API semantics. Payload-specific access implementation MUST NOT leak into public DTOs or client contracts.

## 6. Deny by Default

Unspecified operations are denied.

A newly introduced resource/action MUST NOT become publicly writable merely because no access rule was added.

## 7. Service-to-Service Access

Machine identities MUST use explicit service permissions. A service MUST NOT impersonate an end-user without an auditable delegated identity/context.

## 8. Audit

Security-sensitive authorization decisions SHOULD carry:

```text
actor_id
resource
action
result
reason
request_id
trace_id
```

Mutating administrative decisions MUST be auditable.

## 9. Acceptance Gate

A business domain is not admitted unless it defines:

- resources;
- actions;
- required permissions;
- ownership/scope rules;
- role mapping where required;
- deny-by-default behavior;
- administrative override rules where applicable;
- unauthorized response behavior;
- contract tests.

Forbidden pattern:

```text
if user.role === "admin" { ... }
```

unless that role check is inside the centralized authorization implementation and is itself governed by this contract.
