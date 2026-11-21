# P0 Authorization Contract Reconciliation v1.0

**Status:** SECURITY BLOCKER RESOLUTION

## 1. Reason

The original Identity v1 contract contains a compatibility field:

```text
role = user | admin
```

while the platform authorization model defines L0-L8 layers and multiple role groupings. This document establishes the precedence rule so implementation cannot interpret the compatibility field as the complete authorization authority.

## 2. Canonical authority

The following are authoritative for authorization:

1. `contracts/authz/authorization-decision.json`
2. `contracts/authz/subject-types.json`
3. `contracts/authz/permissions.json`
4. `contracts/authz/layers.json`
5. `contracts/authz/field-policy.json`
6. `contracts/authz/authz-cache-invariant.json`
7. `docs/12-P0-AUTHORIZATION-HARDENING-CONTRACT-v1.0.md`
8. `docs/13-P0-AUTHORIZATION-E2E-MATRIX-v1.0.md`

## 3. Identity compatibility rule

`User.role` in `docs/08-P0-IDENTITY-AND-API-FOUNDATION-CONTRACT-v1.0.md` is a v1 persistence/compatibility field only.

It MUST NOT be interpreted as:

```text
complete authorization
administrator bypass
cross-organization access
cross-resource ownership
entitlement
subscription authority
workflow approval authority
```

The effective authorization decision MUST come from the canonical authorization contract.

## 4. Admin rule

The statement "only admins may change role/status" is interpreted as:

```text
subject has the dedicated permission
AND
subject has required platform/scope authority
AND
account/credential state permits the operation
AND
workflow approval requirements pass
AND
resource policy permits the operation
```

Possessing the string `admin` alone is insufficient.

## 5. Layer rule

L0-L8 is a permission-layer model, not an unrestricted hierarchy.

A higher layer does not automatically inherit every resource operation.

In particular:

```text
L7 != unrestricted business ownership
L8 != unrestricted security bypass
```

Resource ownership, scope, state, policy and explicit permission remain mandatory.

## 6. Payload rule

Payload's internal access result MUST NOT be treated as the public API authorization contract.

A Payload administrator session must not automatically imply public API `SUPER_ADMIN` authority.

The public API must resolve authorization through the canonical decision contract.

## 7. Field mutation rule

The following are never accepted through generic profile/content mass assignment:

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

Dedicated commands with explicit authorization are required.

## 8. Migration rule

Existing `role=user/admin` records remain readable during v1 compatibility.

Future implementation MUST introduce normalized authorization resolution without requiring an immediate destructive migration of existing user records.

When normalized roles/permissions become authoritative, the compatibility field may be retained as a projection until all consumers have migrated.

## 9. CI rule

Contract CI MUST reject:

- role-name-only authorization;
- public API authorization based solely on Payload admin state;
- client-supplied ownership/scope;
- unprotected generic field merge;
- missing authorization evidence;
- missing negative authorization tests.

## 10. Final invariant

```text
User.role is metadata/configuration.
Permission + Scope + Resource + Account State + Policy = Authorization.
```

Missing evidence means **NOT GREEN**.
