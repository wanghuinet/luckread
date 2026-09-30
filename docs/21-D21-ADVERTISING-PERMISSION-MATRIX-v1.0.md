# D21 Advertising Permission Matrix v1.0

## 0. Status

- Domain: D21 Advertising Platform
- Version: 1.0.0
- Status: CONTRACT-FROZEN
- Authorization source: D02 Permission / RBAC Contract
- D21 MUST NOT introduce an independent role or authorization engine.
- Every decision MUST evaluate identity, account state, tenant/organization scope, role, permission, entitlement/subscription where applicable, resource ownership, resource state, risk/policy and explicit delegation.

## 1. Role Profiles

These are permission bundles only. They are not an alternative authorization model.

| Profile | Purpose | Default scope |
|---|---|---|
| ADVERTISER_OWNER | Owns advertising account and commercial configuration | OWN / ORGANIZATION |
| CAMPAIGN_MANAGER | Creates and operates campaigns/ad groups | OWN / ORGANIZATION |
| CREATIVE_MANAGER | Manages creatives and submissions | OWN / ORGANIZATION |
| AUDIENCE_MANAGER | Manages audience definitions | OWN / ORGANIZATION |
| ANALYST | Reads delivery, attribution and reports | OWN / ORGANIZATION |
| BILLING_VIEWER | Reads advertising billing records/exports | OWN / ORGANIZATION |
| DISPUTE_MANAGER | Creates and manages advertiser disputes | OWN / ORGANIZATION |
| AGENCY_OPERATOR | Operates delegated client accounts | DELEGATED_CLIENT |
| PLATFORM_AD_OPERATOR | Platform-side operational control | GLOBAL, explicitly restricted |
| PLATFORM_RISK_OPERATOR | Advertising risk/traffic validity operations | GLOBAL, explicitly restricted |
| PLATFORM_AUDITOR | Read-only evidence/audit access | AUTHORIZED_SCOPE |
| SYSTEM_SERVICE | Machine-to-machine operations | SERVICE_SCOPE_ONLY |

## 2. Capability Matrix

Legend:
- `ALLOW` = permission may be granted when D02 scope/context checks pass.
- `DENY` = role MUST NOT receive the capability by default.
- `CONDITIONAL` = only with explicit delegation, resource scope, state and policy checks.
- `SYSTEM` = service/system operation; never exposed as an ordinary user permission.

| Capability | Owner | Campaign | Creative | Audience | Analyst | Billing | Dispute | Agency | Platform Ops | Risk Ops | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| advertising.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | CONDITIONAL | CONDITIONAL | CONDITIONAL | ALLOW |
| advertising.create | ALLOW | CONDITIONAL | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | SYSTEM | DENY | DENY |
| advertising.update | ALLOW | CONDITIONAL | CONDITIONAL | CONDITIONAL | DENY | DENY | DENY | CONDITIONAL | CONDITIONAL | DENY | DENY |
| advertising.delete | ALLOW | CONDITIONAL | CONDITIONAL | CONDITIONAL | DENY | DENY | DENY | CONDITIONAL | CONDITIONAL | DENY | DENY |
| campaign.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| campaign.create | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | SYSTEM | DENY | DENY |
| campaign.update | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | CONDITIONAL | DENY | DENY |
| campaign.publish | CONDITIONAL | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | CONDITIONAL | DENY | DENY |
| campaign.pause | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | DENY |
| campaign.cancel | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| ad_group.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| ad_group.create | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| ad_group.update | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| ad_group.delete | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | CONDITIONAL | DENY | DENY |
| creative.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| creative.create | ALLOW | CONDITIONAL | ALLOW | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| creative.update | ALLOW | CONDITIONAL | ALLOW | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| creative.submit | ALLOW | CONDITIONAL | ALLOW | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| creative.appeal | ALLOW | CONDITIONAL | CONDITIONAL | DENY | DENY | DENY | ALLOW | CONDITIONAL | ALLOW | DENY | DENY |
| audience.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| audience.create | ALLOW | ALLOW | DENY | ALLOW | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| audience.update | ALLOW | ALLOW | DENY | ALLOW | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| inventory.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| inventory.manage | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY | ALLOW | CONDITIONAL | ALLOW |
| placement.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| placement.manage | CONDITIONAL | DENY | DENY | DENY | DENY | DENY | DENY | DENY | ALLOW | CONDITIONAL | DENY |
| delivery.request | SYSTEM | SYSTEM | SYSTEM | SYSTEM | DENY | DENY | DENY | SYSTEM | SYSTEM | SYSTEM | DENY |
| auction.execute | SYSTEM | SYSTEM | SYSTEM | SYSTEM | DENY | DENY | DENY | SYSTEM | SYSTEM | SYSTEM | DENY |
| traffic.record | SYSTEM | SYSTEM | SYSTEM | SYSTEM | DENY | DENY | DENY | SYSTEM | SYSTEM | SYSTEM | DENY |
| traffic.validate | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY |
| attribution.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| attribution.execute | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY | SYSTEM | CONDITIONAL | DENY |
| billing.read | ALLOW | CONDITIONAL | DENY | DENY | DENY | ALLOW | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| billing.export | ALLOW | CONDITIONAL | DENY | DENY | DENY | ALLOW | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| report.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| report.export | ALLOW | ALLOW | DENY | DENY | ALLOW | CONDITIONAL | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| dispute.create | ALLOW | CONDITIONAL | DENY | DENY | DENY | DENY | ALLOW | CONDITIONAL | ALLOW | DENY | DENY |
| dispute.read | ALLOW | CONDITIONAL | DENY | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| dispute.appeal | ALLOW | CONDITIONAL | DENY | DENY | DENY | DENY | ALLOW | CONDITIONAL | ALLOW | DENY | DENY |
| external_adapter.connect | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | DENY | DENY |
| external_adapter.read | ALLOW | ALLOW | DENY | DENY | ALLOW | CONDITIONAL | DENY | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| external_adapter.sync | ALLOW | CONDITIONAL | DENY | DENY | DENY | DENY | DENY | CONDITIONAL | ALLOW | CONDITIONAL | DENY |
| external_adapter.reconcile | ALLOW | DENY | DENY | DENY | ALLOW | CONDITIONAL | CONDITIONAL | CONDITIONAL | ALLOW | CONDITIONAL | ALLOW |
| evidence.read | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | CONDITIONAL | ALLOW | ALLOW | ALLOW |
| operations.kill_switch | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY | ALLOW | CONDITIONAL | DENY |

## 3. Mandatory Resource Scope Rules

### 3.1 Advertiser isolation

A normal advertiser-side principal MAY access only advertising accounts explicitly owned by, delegated to, or scoped to the principal's organization.

Cross-advertiser access MUST return `ADVERTISER_FORBIDDEN`, even when the caller knows the resource ID.

### 3.2 Agency isolation

Agency access MUST be represented by an explicit delegation/client relationship. Knowing a client account ID is never sufficient authorization.

Delegation MUST include:
- agency organization;
- client advertiser account;
- allowed capabilities;
- resource scope;
- effective start/end;
- status;
- grantor;
- audit reference.

### 3.3 Billing separation

Campaign managers MAY view billing information only when explicitly granted `billing.read` in the relevant scope.

No advertiser-side role may mutate finalized billing history.

Billing adjustments/reversals are append-only operations controlled by the advertising billing kernel and authorized operational principals.

### 3.4 Traffic validity separation

Advertisers can READ traffic-quality decisions and dispute them where permitted.

Advertisers MUST NOT grant themselves `traffic.validate`, `traffic.record` or `billing.finalize`.

### 3.5 Platform operations

`operations.kill_switch`, `auction.execute`, `traffic.validate`, external reconciliation and similar operational capabilities are not normal user permissions.

They require platform-scoped service/operator authorization, explicit audit logging and execution evidence.

## 4. State-Aware Authorization

Permission alone is insufficient.

Examples:

```text
campaign.publish
AND campaign.state == APPROVED
AND creative.state == APPROVED/ACTIVE
AND advertiser.state == ACTIVE
AND policy == ALLOW
AND risk != BLOCKED
AND budget == AVAILABLE
```

```text
billing.finalize
AND traffic.validity == VALID
AND evidence_chain == COMPLETE
AND fraud_outage == false
```

A request MUST be denied if the required state precondition is not satisfied.

## 5. High-Risk Negative Authorization Tests

CI MUST prove all of the following:

1. User cannot access another advertiser's campaign.
2. Campaign manager cannot modify billing.
3. Billing viewer cannot modify campaign.
4. Creative manager cannot publish an unapproved campaign.
5. Audience manager cannot read unauthorized private audience definitions.
6. Agency operator cannot access an undelegated client.
7. Expired agency delegation is denied.
8. Suspended advertiser cannot launch campaigns.
9. Restricted advertiser cannot bypass risk controls.
10. Advertiser cannot mark invalid traffic as valid.
11. Advertiser cannot finalize billing.
12. Auditor cannot mutate any advertising resource.
13. Platform operator cannot bypass tenant/resource scope unless the operation is explicitly GLOBAL and audited.
14. Internal/local API cannot bypass D02 authorization.
15. External adapter cannot directly mutate billing finality.
16. Known resource IDs cannot bypass authorization.
17. Cross-organization access is denied.
18. Deleted/closed advertiser data remains protected according to retention policy.
19. Kill switch cannot be invoked by advertiser-side roles.
20. D21 cannot bypass D13 policy/risk or D15 payment/settlement boundaries.

## 6. Service-to-Service Rules

Service credentials MUST use explicit service identities and least-privilege scopes.

The following are prohibited:

- wildcard advertising permissions;
- shared super-user tokens;
- hidden local authorization bypass;
- direct database writes that skip authorization/audit;
- service identity impersonation without an audited delegation;
- treating `SYSTEM` capabilities as ordinary user permissions.

## 7. Evidence Requirements

Every privileged D21 operation MUST be reconstructable using:

- request_id;
- trace_id;
- actor/service identity;
- tenant_id;
- organization_id;
- resource_id;
- permission/capability;
- authorization decision;
- policy version;
- state version;
- timestamp;
- idempotency key where applicable;
- resulting event ID.

Billing finalization additionally requires the complete advertising evidence chain.

## 8. Contract Gate

D21 Permission Matrix is GREEN only when:

```text
Permission Contract
→ Machine-readable Capability Registry
→ API Operation Mapping
→ State Preconditions
→ Tenant/Organization Isolation
→ Negative Authorization Tests
→ Service Identity Tests
→ Execution Probe
→ Evidence
→ GREEN
```

Unknown authorization evidence = `BLOCKED`.

`CODE COMPLETE != VALIDATION COMPLETE != EVIDENCE COMPLETE != GREEN`.
