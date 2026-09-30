# LuckRead Commerce Order / Fulfillment Permission and Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE**

## 1. Principals

```text
CUSTOMER
MERCHANT
MERCHANT_STAFF
FULFILLMENT_OPERATOR
SUPPORT
FINANCE_REVIEWER
PLATFORM_ADMIN
```

## 2. Scope Rules

Access is evaluated as:

```text
Identity
→ Session/App Scope
→ Resource Scope
→ Role/Permission
→ Data Sensitivity
→ Action Risk
→ Mutation
→ Audit
```

## 3. Sensitive Operations

Inventory consumption, fulfillment override, cancellation after dispatch, return approval, dispute resolution and provider configuration require explicit scoped permission.

## 4. Privacy

Customer address, contact details and after-sales evidence are purpose-limited. Logs and analytics receive references or redacted summaries only.

## 5. Provider Security

External provider credentials are isolated secrets; callbacks require signature verification and idempotency validation.

## 6. Abuse Protection

High-volume reservation, cancellation, refund-linked operations and replay are subject to risk/rate controls.

## 7. Audit

Sensitive mutations record actor, action, target, reason, requestId, correlationId and timestamp.

## 8. STOP

- staff scope bypass;
- customer data leakage;
- unsigned provider callback;
- privileged operation without audit;
- external provider directly mutating authority.

## 9. Status

```text
SECURITY = COMPLETE
IMPLEMENTATION = PENDING
```
