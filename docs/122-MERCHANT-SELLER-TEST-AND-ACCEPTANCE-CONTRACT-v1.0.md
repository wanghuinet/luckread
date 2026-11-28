# LuckRead Merchant / Seller Test & Acceptance Contract v1.0

**状态：TEST-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. P0 Functional Acceptance

- merchant creation and unique identity
- qualification submission/approval/rejection
- store create/update/pause/resume/close
- staff invite/accept/remove
- role and scope enforcement
- product and content reference binding
- fulfillment configuration
- merchant restriction/suspension/reinstatement
- audit record generation

## 2. Consistency Acceptance

Must verify:

```text
retry → no duplicate merchant/store/staff fact
concurrent update → version conflict, no silent overwrite
event replay → no duplicate authority
projection rebuild → same derived result
```

## 3. Security Acceptance

Verify owner isolation, store isolation, delegated scope, public/private DTO separation, sensitive evidence protection and privilege escalation resistance.

## 4. Cross-Domain Acceptance

Commerce/order/payments/ledger/rights/risk integrations must consume references according to their contracts and must not create a second Merchant authority.

## 5. Runtime Acceptance

Verify W01-only public ingress, W08 authorization, W07-only Merchant/Seller business ownership, approved D1-04 schema mapping, production persistence selected only from verified deployment/cutover evidence, existing W10 asynchronous handoff, cache invalidation and degraded downstream behavior. Tests must prove no direct client-to-database access, dual write, new Worker, database, Queue or Service Binding.

## 6. STOP

Any P0 authority conflict, authorization bypass, duplicate mutation, evidence leakage or unrecoverable event inconsistency is FAIL.
