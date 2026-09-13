# LuckRead Membership Permission & Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

## 1. Authorization Chain

```text
Authentication
→ Actor
→ App / Session Context
→ Subscriber / Creator / Organization Scope
→ Membership Permission
→ Resource Scope
→ Mutation / Read
→ Audit
```

## 2. Roles

Subscriber permissions:

```text
self.read
self.manage
self.cancel
self.change_plan
```

Creator permissions:

```text
plan.create
plan.update
plan.retire
member.read
membership.policy.manage
```

Organization/MCN permissions are delegated only within explicit resource scope.

Admin/support actions require elevated authorization and audit.

## 3. Security Rules

- entitlement cannot be client-authored;
- payment result must come from trusted commerce/payment boundary;
- one actor cannot use another subscriber's subscription reference;
- creator cannot read private subscriber data without declared scope;
- external apps require explicit OAuth/API scope;
- support tools cannot silently grant indefinite entitlements;
- sensitive membership changes require audit records;
- replayed mutation must not duplicate access.

## 4. Privacy

Public surfaces may expose aggregate counts but not raw subscriber identities unless policy permits. Membership exports must follow least privilege and data minimization.

## 5. Abuse Protection

Rate limit subscription mutations, membership management, entitlement checks, invitation-like flows and administrative grants. Detect repeated failed mutations and suspicious entitlement patterns through Risk/Trust integration.

## 6. Cross-Domain Boundary

```text
Membership → entitlement lifecycle
Commerce   → transaction
Payment    → payment outcome
Ledger     → financial truth
Risk       → abuse/risk decision
Moderation → enforcement decision
```

No domain may bypass another domain's authoritative decision.
