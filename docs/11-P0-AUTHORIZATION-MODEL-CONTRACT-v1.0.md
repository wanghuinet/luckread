# LuckRead P0 Authorization Model Contract v1.0

**Status:** READY FOR IMPLEMENTATION
**Scope:** Platform-wide authorization semantics. This contract defines authorization composition; domain contracts define resource-specific permissions.

## 1. Purpose

Authorization must be evaluated from a stable principal model rather than from a single `role` field. No domain may invent an independent permission model.

## 2. Authorization decision

The effective authorization decision is:

```text
ALLOW =
  authenticated principal
  AND account state permits operation
  AND required permission is granted
  AND required entitlement/subscription is satisfied
  AND organization scope is valid
  AND resource scope/ownership is valid
  AND policy conditions pass
```

Default behavior is **deny** when any required authorization dimension is unknown, stale or invalid.

## 3. Principal dimensions

Every protected request resolves, where applicable:

- `userId`
- `accountState`
- `accountStateVersion`
- `roles`
- `roleVersion`
- `entitlements`
- `subscription`
- `organizationMemberships`
- `organizationVersion`
- `scopes`
- `policyVersion`
- authentication assurance / MFA state

Clients cannot submit these dimensions as trusted authorization input.

## 4. Role model

Roles describe authority categories. They do not by themselves grant unrestricted access to every resource.

Initial platform role categories may include:

- `user`
- `admin`
- `creator`
- `ip_founder`
- `ip_manager`
- `mcn_member`
- `mcn_admin`
- `moderator`
- `editor`
- `finance`
- `developer`
- `app_owner`

Additional roles require an explicit contract change. A role is not a substitute for resource ownership or organization scope.

## 5. Entitlement and subscription

Entitlements represent capability grants. Subscription represents the commercial/account plan that may produce one or more entitlements.

```text
Subscription
    ↓
Entitlement
    ↓
Permission eligibility
```

A subscription must never bypass account suspension, resource ownership, organization scope or safety policy.

## 6. Organization scope

Organization membership is explicit and scoped.

A user may belong to multiple organizations. An organization role applies only within its authorized organization scope unless a separate global grant exists.

```text
user
  + organizationId
  + membershipRole
  + membershipState
  + organizationVersion
```

No organization membership automatically grants access to unrelated organizations.

## 7. Permission format

Permissions use the machine-readable form:

```text
resource.action
```

Examples:

```text
content.read
content.update
content.publish
content.delete
ip.read
ip.manage
creator.manage
organization.member.manage
revenue.read
revenue.settle
```

Domain contracts own the authoritative permission vocabulary for their resources.

## 8. Resource scope and ownership

Authorization must distinguish:

```text
permission
+ resource
+ ownership/control
+ organization scope
+ explicit grant
```

Possessing `content.update` does not permit updating arbitrary content.

Possessing `ip.manage` does not automatically grant control over every IP.

## 9. IP Founder and IP Manager

`IP Founder` and `IP Manager` are distinct authorities.

- Founder represents the contractual ownership/control authority defined by the IP domain.
- Manager represents delegated operational authority.
- Creator represents content creation/authorship authority and is not automatically an IP controller.
- Author represents display/authorship and is not automatically the legal owner.

Delegation must be explicit, scoped and revocable.

## 10. Account-state enforcement

Authorization is denied for operations prohibited by the current account state.

Examples:

- suspended accounts cannot perform protected mutations;
- banned accounts cannot authenticate into protected product operations;
- deletion-pending accounts follow the account recovery/deletion contract;
- restricted accounts may have a reduced permission set.

Cached authorization data must not override authoritative suspension/ban state.

## 11. Sensitive operations

Sensitive operations require stronger assurance according to domain policy. Examples include:

- role changes;
- organization administration;
- IP control changes;
- financial operations;
- credential/security changes;
- developer/app ownership changes.

The policy may require recent authentication, MFA, explicit confirmation or additional review.

## 12. Fail-closed and cache invariants

Authorization caches must be treated as optimization only.

Required invariants:

1. Unknown authorization state => deny.
2. Version mismatch => refresh authoritative state or deny.
3. Account suspension/ban cannot be bypassed by a stale cache.
4. Sensitive authorization decisions may require cache mode `none`.

## 13. API boundary

Public APIs return authorization failures through the common error contract. They do not expose internal policy evaluation details that would enable privilege probing.

The API must not accept client-provided role, entitlement, organization membership or scope as authoritative.

## 14. Audit

Authorization-sensitive mutations must produce an audit record containing, where applicable:

- actor;
- target resource;
- organization scope;
- action;
- decision/result;
- timestamp;
- request/correlation ID;
- policy/version context.

## 15. Acceptance criteria

1. No domain defines an independent authorization authority.
2. Authorization is fail-closed.
3. Role alone cannot bypass resource ownership or organization scope.
4. Entitlement/subscription cannot bypass account-state restrictions.
5. IP Founder, IP Manager, Creator and Author remain distinct concepts.
6. Stale authorization state cannot silently grant protected access.
7. Sensitive operations have explicit assurance requirements.
8. Public APIs expose stable authorization errors without Payload internals.
9. Authorization decisions are auditable for sensitive mutations.
10. Machine-readable permission identifiers use `resource.action`.
