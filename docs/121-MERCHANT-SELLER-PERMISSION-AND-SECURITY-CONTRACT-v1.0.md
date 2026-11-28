# LuckRead Merchant / Seller Permission & Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Scope Model

```text
Actor
→ User/App
→ Merchant
→ Store
→ Resource
→ Action
```

Default deny. A valid merchant relationship never implies unrestricted store authority.

## 2. Roles

```text
Owner
Admin
Operator
CustomerService
Finance
Analyst
```

Financial role is view/operation scoped and cannot mutate Ledger facts. Customer service cannot change ownership or privileged staff roles.

## 3. Sensitive Actions

Require enhanced authorization and audit:

- merchant suspension/reinstatement
- store ownership change
- staff privilege escalation
- mass product binding changes
- fulfillment policy change
- sensitive merchant evidence access
- external app credential/scopes

## 4. Security Controls

Must support:

```text
session validation
scope validation
least privilege
idempotency/replay protection
rate limiting
audit logging
privacy filtering
abuse detection
```

## 5. Cross-Domain Rules

Commerce verifies merchant eligibility before commercial mutations. Rights verifies legal usage where required. Risk can block high-risk actions. None of these systems may redefine Merchant identity.
## 6. Runtime Enforcement Boundary

W01 is the only public ingress and invokes W08/CASL for the action and resource scope before forwarding a trusted principal to W07. W07 independently enforces merchant/store ownership, qualification state and expected-version constraints before PostgreSQL mutation. Missing W08/W07 binding, stale principal, unresolved scope or database authority failure must fail closed. Client-supplied merchant/seller IDs, legal status, qualification state or tax evidence never establish authority.
