# LuckRead Advertising L1-L4 Traceability and Contract Admission v1.0

**状态：TRACEABILITY-COMPLETE / CONTRACT-READY**

## 1. Admission Chain

```text
66 Advertising Platform
→ 132 L1-L4 Traceability
→ 133 Data Contract
→ 134 API Contract
→ 135 Event Contract
→ 136 Permission/Security
→ 137 Test/Acceptance
→ 138 Ready Gate
```

## 2. Traceability Matrix

| L2 | Authority | Data | API/Control | Event | Security | Test |
|---|---|---|---|---|---|---|
| Advertiser / Organization | Advertising | Advertiser | manage advertiser | advertiser.* | tenant/role | isolation/lifecycle |
| Campaign | Advertising | Campaign | create/pause/resume | campaign.* | owner/manager | lifecycle |
| Ad Group / Delivery Plan | Advertising | AdGroup | delivery plan controls | delivery_plan.* | scoped operator | pacing |
| Creative | Advertising | Creative | creative lifecycle | creative.* | creative scope | policy/lifecycle |
| Placement Inventory | Advertising | Placement | registry/eligibility | placement.* | platform admin | eligibility |
| Targeting | Advertising | TargetingDefinition | targeting controls | targeting.* | privacy scope | policy |
| Budget / Pacing | Advertising | BudgetState | budget/pacing controls | budget.* | billing scope | accounting/race |
| Delivery | Advertising | DeliveryDecision | decide/deliver | delivery.* | runtime scope | latency/safety |
| Measurement | Advertising | MeasurementEvent | ingest | ad.* | signed/event auth | dedupe |
| Attribution | Advertising | AttributionState | attribution control | attribution.* | restricted | reproducibility |
| Risk / Invalid Traffic | Risk + Advertising | DecisionRef | policy controls | ad.invalid.* | restricted | exclusion |
| Reporting | Advertising | DerivedReport | report generation | report.* | tenant/read scope | correctness |
| Governance | Advertising | Audit/PolicyRef | suspend/restore | policy.* | privileged | audit |

## 3. Authority Rule

Advertising owns advertising state and delivery decisions. User, Creator, Content, Media, Rights, Risk, Moderation, Commerce and Ledger remain authoritative for their respective facts.

## 4. Mandatory Invariants

- campaign cannot deliver before required approval;
- delivery decision has stable campaign/creative references;
- measurement is deduplicable;
- invalid activity cannot silently become billable;
- budget guardrails cannot rely only on cache;
- financial posting remains outside Advertising authority;
- sensitive targeting is policy-gated;
- tenant isolation is mandatory.

## 5. Cross-Domain

Reconcile with 55 Feed/Recommendation, 62 Risk/Trust, 63 Moderation, 64 Rights, 65 Commerce, 67 Marketplace, 68 Ledger, 69 Analytics, 76 Creator, 116 Merchant.

## 6. Status

```text
TRACEABILITY = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
