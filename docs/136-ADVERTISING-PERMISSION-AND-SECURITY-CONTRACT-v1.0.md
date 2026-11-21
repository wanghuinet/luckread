# LuckRead Advertising Permission and Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / CONTRACT-READY**

## 1. Authorization Model

```text
Actor
→ Advertiser / Organization Tenant
→ Role
→ Resource Scope
→ Policy / Privacy / Risk Check
→ Mutation or Delivery Action
→ Audit
```

## 2. Roles

```text
OWNER
ADMIN
CAMPAIGN_MANAGER
CREATIVE_MANAGER
ANALYST
BILLING_MANAGER
PLATFORM_OPERATIONS
```

Roles are tenant-scoped and cannot cross advertiser boundaries.

## 3. Mandatory Controls

- server-side authorization;
- tenant isolation;
- ownership checks;
- least privilege;
- idempotency on retryable mutations;
- request/correlation IDs;
- rate limiting;
- replay protection for sensitive operations;
- audit logging;
- secret isolation;
- privacy-purpose checks.

## 4. Sensitive Data

Targeting inputs, audience references, billing references, conversion evidence and moderation/risk references must use minimum necessary disclosure. Raw internal risk scores and protected attributes must not be exposed through ordinary Advertising APIs.

## 5. Delivery Security

Delivery decisions must use signed/validated tracking references where needed and reject expired or replayed sensitive tokens.

## 6. Measurement Security

Ingestion must validate source, event structure and dedupe key. Suspicious events must be quarantined or marked invalid rather than silently accepted as billable evidence.

## 7. Administrative Actions

Campaign suspension, emergency stop, policy override, budget controls and sensitive audience operations require elevated permission and audit evidence.

## 8. Incident / Breach Boundary

Security failure in an external ad provider must be isolated. Provider credentials must be revocable and must not become client-visible secrets.

## 9. STOP

- cross-tenant data access;
- client-controlled authorization;
- sensitive targeting exposure;
- risk-score leakage;
- provider secret leakage;
- unaudited privileged mutations.

## 10. Status

```text
SECURITY = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
