# LuckRead Merchant / Seller Ready Admission Gate v1.0

**状态：ADMISSION-CONTRACT-COMPLETE / IMPLEMENTATION BLOCKED UNTIL UNIFIED CL**

## 1. Contract Chain

```text
116 Capability Contract
→ 117 L1-L4 Traceability
→ 118 Data Contract
→ 119 API Contract
→ 120 Event Contract
→ 121 Permission/Security
→ 122 Test/Acceptance
→ 123 Final Admission
```

## 2. Mandatory Gates

### G1 Capability

All eight L2 domains must be complete:

```text
Merchant Identity
Seller Qualification
Store Management
Merchant Staff & Delegation
Product Operating Relationship
Fulfillment Configuration
Merchant Operations
Merchant Governance
```

### G2 Authority

```text
Merchant/Store → Merchant authority
Product/Offer/Order/Entitlement → Commerce
Payment → Payment provider boundary
Money → Ledger
Creator → Creator System
Rights → Rights
Risk → Risk/Trust
```

No external commerce engine, cache or projection may become hidden Merchant authority.

### G3 Data/API/Event

Each L4 must have authoritative data mapping, versioned API/control mapping and auditable event semantics where state changes occur.

### G4 Security

Owner, merchant, store, staff, role, application and privileged-admin scopes must be explicit and machine-checkable.

### G5 Cross-Domain Reconciliation

Must reconcile with:

```text
65 Commerce
67 Creator/IP Marketplace
68 Wallet/Ledger
69 Analytics
70 Open Platform
71 Platform Operations
72 User Center
53 Search
55 Feed/Recommendation
62 Risk/Trust
63 Moderation
64 Rights
```

### G6 Runtime

The target physical schema must use the existing Neon finance PostgreSQL database (logical D1-04) with W07 as sole Merchant/Seller authority owner. Existing D1 remains production storage authority until a separate cutover is explicitly approved and verified. Public APP/H5/PC traffic must enter through W01, authorization must use the existing W08/CASL boundary, and asynchronous propagation must use only the existing W10 Queue/workflow boundary where appropriate. R2 may hold controlled evidence/media objects; Cache/KV are derived projections only. No new D1 binding/fallback, direct client database access, dual-write path, new Worker, database, Queue or Service Binding is allowed. Existing production D1 bindings remain only until the separately approved cutover. External engines remain replaceable adapters.

### G7 Acceptance

All P0 cases in 122 require deterministic implementation evidence. Unified CL/CI must pass before READY.

## 3. Admission Decision

```text
PASS
FAIL
BLOCKED
```

`BLOCKED` is not `PASS`.

## 4. STOP

- duplicate merchant/store authority
- Commerce or external engine overwrites Merchant authority
- staff scope bypass
- qualification bypass
- sensitive evidence leakage
- financial facts stored as merchant balance
- non-idempotent lifecycle mutation
- CL/CI not passed but marked READY

## 5. Current State

```text
CAPABILITY        = COMPLETE
TRACEABILITY      = COMPLETE
DATA              = COMPLETE
API               = COMPLETE
EVENT             = COMPLETE
SECURITY          = COMPLETE
TEST / ACCEPTANCE = COMPLETE
FINAL GATE        = DEFINED
IMPLEMENTATION    = BLOCKED UNTIL UNIFIED CL
CL / CI           = NOT RUN
```
