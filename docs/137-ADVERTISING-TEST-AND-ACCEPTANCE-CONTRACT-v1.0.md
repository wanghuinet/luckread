# LuckRead Advertising Test and Acceptance Contract v1.0

**状态：TEST/ACCEPTANCE-CONTRACT-COMPLETE / CONTRACT-READY**

## 1. Functional Acceptance

P0 must verify:

1. advertiser tenant isolation;
2. campaign lifecycle;
3. ad group pause/resume;
4. creative approval gate;
5. placement eligibility;
6. targeting policy enforcement;
7. budget and pacing controls;
8. bounded delivery decision;
9. frequency capping;
10. measurement deduplication;
11. attribution reproducibility;
12. invalid-traffic exclusion;
13. reporting generation;
14. billing candidate boundary.

## 2. Security Acceptance

- unauthorized advertiser mutation rejected;
- cross-tenant read rejected;
- privileged operations audited;
- sensitive targeting fields protected;
- internal risk details not exposed;
- replayed sensitive requests rejected;
- provider credentials never returned to clients.

## 3. Reliability Acceptance

- duplicate event ingestion is safe;
- duplicate callback is safe;
- out-of-order events do not corrupt state;
- queue retry does not double count;
- DLQ/replay restores processable failures;
- provider outage degrades safely;
- reporting failure does not block delivery;
- delivery failure does not create false billing.

## 4. Accounting Acceptance

Verify:

```text
Measurement
→ Validation
→ Attribution
→ Billing Candidate
→ Commerce / Ledger
```

No raw impression/click/conversion event directly posts financial facts.

## 5. Privacy Acceptance

Verify consent, regional restrictions, deletion propagation, data minimization and retention behavior.

## 6. Performance Acceptance

P0 delivery decision must have a bounded latency budget. High-frequency event paths must not require one authoritative database write per event unless explicitly justified.

## 7. Evidence

Every acceptance case must produce deterministic evidence sufficient for machine or reviewer verification. PASS must not be inferred from document presence alone.

## 8. STOP

Any violation of tenant isolation, policy approval, deduplication, accounting boundary, privacy or security blocks admission.

## 9. Status

```text
TEST / ACCEPTANCE = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
