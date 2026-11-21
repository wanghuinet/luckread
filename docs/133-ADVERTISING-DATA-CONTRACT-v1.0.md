# LuckRead Advertising Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / CONTRACT-READY**

## 1. Authoritative Model

```text
Advertiser
Campaign
AdGroup
Creative
Placement
TargetingDefinition
BudgetState
DeliveryDecision
MeasurementEvent
AttributionState
PolicyReference
```

All records have stable IDs, status/version where mutable, timestamps and tenant ownership references.

## 2. Core Rules

- Advertising records are authoritative only inside Advertising domain.
- External domain entities are referenced by stable IDs; their full records are not copied as authority.
- Financial amounts use integer minor units and currency references when present, consistent with 65/68.
- Raw events are immutable evidence references; derived attribution/reporting is rebuildable.
- Sensitive targeting data is minimized and access-controlled.

## 3. Campaign / AdGroup / Creative

Minimum references:

```text
advertiserId
campaignId
adGroupId
creativeId
placementId
policyVersion
status
version
createdAt
updatedAt
```

## 4. Budget State

```text
budgetType
totalLimitMinor
dailyLimitMinor
spentCandidateMinor
reservedMinor
currency
version
asOf
```

Budget state is authoritative inside Advertising but financial posting remains in Ledger.

## 5. Delivery Decision

```text
decisionId
campaignId
adGroupId
creativeId
placementId
policyVersion
sponsoredLabel
trackingTokenRef
expiresAt
requestId
createdAt
```

Internal risk scores and sensitive targeting internals are not public data.

## 6. Measurement / Attribution

Measurement minimum:

```text
eventId
eventType
decisionId
campaignId
creativeId
occurredAt
sourceRef
dedupeKey
qualityState
```

Attribution minimum:

```text
attributionId
sourceEventRef
conversionRef
modelVersion
window
eligibilityState
result
createdAt
```

Both support replay/rebuild according to policy.

## 7. Retention / Privacy

Retention differs by event, operational, policy and financial evidence requirements. Privacy deletion must respect legal, fraud and accounting retention constraints.

## 8. Invariants

- unique dedupe key for measurement;
- versioned mutable advertising state;
- no float monetary fields;
- no secret/token persistence in ordinary telemetry;
- no direct Ledger mutation through Advertising storage;
- reporting is derived.

## 9. Status

```text
DATA = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
