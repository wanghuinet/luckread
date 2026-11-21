# Luckread D1-04 Candidate Entity-Level Diff v1.0

> **Status: ACTIVE / CANDIDATE ANALYSIS / NOT FROZEN**
>
> Scope: reverse-audit the Q/R/S commerce, payment, revenue, settlement and advertising boundaries against the frozen 12 Worker / 4 D1 / 25 Task architecture target.
>
> This document does **not** create or freeze `D1-04`. It records evidence and a proposed entity-level boundary for Change Control.

## 1. Authority

The canonical architecture requires exactly 4 D1 domains and requires domain ownership to be explicitly frozen rather than inferred from code. fileciteturn151file0

The functional Blueprint defines Payments, Wallet, Revenue and Settlement as domain R and includes payment abstraction, orders, invoices, refunds, chargebacks, wallet/ledger, creator revenue, settlement, tax/financial records and currency support. fileciteturn156file0

The existing financial instance registry defines the financial authority boundary: Ledger is the authoritative financial record; wallet balance is a derived/controlled view; creator earnings and payouts must create traceable ledger effects; advertising spend must reconcile into ledger authority. fileciteturn157file0

## 2. Entity-Level Classification

| Entity / capability | Candidate domain | Classification | Decision |
|---|---|---|---|
| Subscription | D1-01 | Account / entitlement state | RETAIN D1-01 |
| Entitlement | D1-01 | Authorization/access state | RETAIN D1-01 |
| Merchant | D1-04 candidate | Commerce authority | CANDIDATE |
| Product / ProductVersion | D1-04 candidate | Commerce catalog authority | CANDIDATE |
| Cart | D1-04 candidate | Commerce transaction context | CANDIDATE |
| Checkout | D1-04 candidate | Commerce transaction context | CANDIDATE |
| Order | D1-04 candidate | Commerce financial-adjacent authority | CANDIDATE |
| Invoice | D1-04 candidate | Financial document | CANDIDATE |
| PaymentIntent / Payment | D1-04 candidate | Payment authority | CANDIDATE |
| Refund | D1-04 candidate | Financial reversal authority | CANDIDATE |
| Chargeback | D1-04 candidate | Financial dispute authority | CANDIDATE |
| Wallet | D1-04 candidate | Financial account view/control | CANDIDATE |
| LedgerEntry | D1-04 candidate | **Authoritative financial fact** | CANDIDATE / HIGH |
| LedgerPeriod | D1-04 candidate | Accounting authority | CANDIDATE |
| RevenueShare | D1-04 candidate | Revenue allocation | CANDIDATE |
| CreatorEarnings | D1-04 candidate | Revenue fact/projection backed by ledger | CANDIDATE |
| PayableReserve | D1-04 candidate | Financial obligation | CANDIDATE |
| SettlementBatch | D1-04 candidate | Settlement authority | CANDIDATE |
| Payout | D1-04 candidate | External financial execution | CANDIDATE |
| Tax / FinancialRecord | D1-04 candidate | Financial record | CANDIDATE |
| Currency | D1-04 candidate | Financial contract/reference data | CANDIDATE |
| Advertising Campaign | Separate Advertising boundary | Advertising business state | **NOT automatically D1-04** |
| Advertising Creative | Separate Advertising boundary | Advertising business state | **NOT automatically D1-04** |
| Advertising Targeting | Separate Advertising boundary | Advertising business state | **NOT automatically D1-04** |
| Advertising Budget | Advertising boundary | Budget/pacing state | **NOT automatically D1-04** |
| Ad Impression / Click | Derived/event input | Attribution/event data | **NOT financial authority** |
| Ad Spend | D1-04 candidate only after reconciliation | Financial posting input | CANDIDATE |
| AuditEvent | D1-03 | Operational/audit authority | RETAIN D1-03 |
| Job / DLQ / Idempotency operation records | D1-03 | Operational state | RETAIN D1-03 |

## 3. Critical Boundary Rules

### 3.1 Subscription is not Ledger

Subscription and entitlement determine access and remain part of account/authorization authority. A successful payment may trigger an entitlement transition, but it must not make the payment system the authority for access state.

### 3.2 Order is not Ledger

Order lifecycle is authoritative for commerce order state. Payment-provider state must not silently mutate order state. The financial registry explicitly requires validated payment authority and deterministic reconciliation.

### 3.3 Ledger is the financial source of truth

Ledger entries are immutable financial facts. Corrections use compensating/reversal semantics rather than destructive mutation. Wallet balance must reconcile to ledger invariants. fileciteturn157file0

### 3.4 Advertising is not wholly D1-04

Campaign, creative, targeting, delivery and budget/pacing remain advertising business state. Financial posting of reconciled ad spend is the part that can enter the financial authority boundary.

### 3.5 Operational records remain D1-03

Audit, jobs, retry/DLQ and operational idempotency records should not be moved into the financial domain merely because they participate in financial workflows. Their purpose is runtime/reliability governance, not financial truth.

## 4. Candidate D1-04 Boundary

Proposed candidate name:

> **D1-04 Candidate — Commerce / Financial Authority**

Candidate authoritative families:

```text
Commerce
 ├── Merchant
 ├── Product / ProductVersion
 ├── Cart / Checkout
 ├── Order / Invoice
 └── Promotion / pricing snapshots

Payment
 ├── PaymentIntent
 ├── Payment
 ├── Refund
 └── Chargeback

Financial
 ├── Wallet
 ├── LedgerEntry
 ├── LedgerPeriod
 ├── RevenueShare
 ├── CreatorEarnings
 ├── PayableReserve
 ├── SettlementBatch
 ├── Payout
 ├── Tax / FinancialRecord
 └── Currency
```

This is a **candidate boundary only**. It becomes canonical only after Blueprint/Data Change Control approval.

## 5. Cross-Domain References

The candidate design must avoid unrestricted foreign-key coupling across all four D1 domains.

Expected reference direction:

```text
D1-01 Account / Entitlement
          │
          │ stable actor / account IDs
          ▼
D1-04 Commerce / Financial
          │
          │ financial evidence / settlement events
          ▼
D1-03 Operational / Audit
```

D1-02 Content may provide product/content identifiers to commerce, but financial authority must not depend on synchronous reads of content state for settlement correctness.

## 6. Existing Evidence / Remaining Gaps

Evidence already establishes:

- final topology = 4 D1 domains;
- payment/wallet/revenue/settlement is an explicit functional domain;
- ledger is financial authority;
- financial operations require idempotency, reconciliation, audit and portability;
- advertising spend requires reconciliation into financial authority. fileciteturn155file0 fileciteturn155file2

Remaining blockers before D1-04 freeze:

1. authoritative 4-D1 Master is not yet frozen;
2. canonical Worker Master is not yet approved;
3. existing legacy D1-01/02/03 contracts must be checked for financial entities that conflict with this candidate boundary;
4. each candidate entity needs canonical Data ID, API ID, Security ID, State ID and Test/Evidence bindings;
5. Worker ownership must be resolved without silently reusing legacy W00;
6. Change Control must formally approve the candidate boundary.

## 7. STOP Conditions

Do not:

- rename D1-01/02/03 merely to obtain D1-04;
- move Subscription/Entitlement out of D1-01 without an authoritative change;
- move all Advertising entities into D1-04;
- treat Wallet balance as independent financial truth;
- mutate Ledger entries destructively;
- create a fifth D1;
- assign Worker ownership from directory names or existing code;
- mark the Mapping GREEN while D1-04 remains candidate-only.

## 8. Next Gate

The next required artifact is the **4-D1 Domain Master Change-Control Proposal** containing:

```text
D1-01 identity/account/authorization
D1-02 content/media/community
D1-03 operational/system/audit
D1-04 candidate commerce/financial authority
```

For each domain it must freeze:

- domain identity
- authoritative entities
- read/write authority
- transaction boundary
- cross-domain reference policy
- event boundary
- Worker binding dependency
- migration boundary
- security boundary
- test/evidence obligations

Until that artifact is approved, D1-04 remains CANDIDATE and Contract implementation remains blocked.
