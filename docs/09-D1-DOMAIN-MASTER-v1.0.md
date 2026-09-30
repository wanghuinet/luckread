# LuckRead D1 Domain Master v1.0

**Status: ACTIVE / CANONICAL D1 DOMAIN MASTER**

## 1. Authority

This document is the canonical relational-storage ownership baseline for LuckRead.

Authority hierarchy:

1. `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
2. `docs/00-PROJECT-BLUEPRINT-v1.4.md`
3. `docs/02-FINAL-MAPPING-v1.0.md`
4. This D1 Domain Master
5. Contracts, implementation, tests and evidence derived from the frozen mapping

Historical D1 and Worker topology documents remain evidence/reference unless explicitly promoted through Change Control.

## 2. Frozen topology

- Workers: exactly 12
- D1 domains: exactly 4
- Contract Tasks: exactly 25

No fifth D1 domain may be introduced implicitly.

## 3. Canonical D1 domains

| Domain | Canonical authority |
|---|---|
| D1-01 | Identity / Account / Access |
| D1-02 | Content / Community Data |
| D1-03 | Platform Operations / Governance / Runtime |
| D1-04 | Commerce / Financial Authority |

## 4. D1-01 — Identity / Account / Access

### Authority

D1-01 owns identity, account lifecycle, authentication-related durable state, authorization state, entitlement/access state, subscription/membership access state, organization identity relationships and creator identity/profile state.

### Primary entities

- User
- Identity
- Credential
- Session
- Role
- RoleAssignment
- Entitlement
- Subscription / Membership access state
- Organization
- Organization membership / invitation / team
- Creator identity/profile
- Identity-linked verification state

### Invariants

- User/account authority belongs only to D1-01.
- Role and authorization authority belongs only to D1-01.
- Entitlement/access authority belongs only to D1-01.
- Subscription remains D1-01 when representing membership/access authority.
- Payment and financial facts do not become D1-01 authority.

## 5. D1-02 — Content / Community Data

### Authority

D1-02 owns content and community-domain durable state.

### Primary entities

- Content
- Article
- Gallery
- Video metadata
- Audio metadata
- Live metadata
- Revision
- Media metadata/reference
- Comment
- Reply
- Share
- Content-interaction records assigned by the Blueprint to content/community state

### Invariants

- Content authority belongs only to D1-02.
- Media metadata/reference authority belongs to D1-02; physical media storage remains subject to the storage boundary.
- Feed, recommendation and search projections are not authoritative content state.
- Financial facts do not become D1-02 authority.
- Account/access authority does not become D1-02 authority.

## 6. D1-03 — Platform Operations / Governance / Runtime

### Authority

D1-03 owns platform operational, governance and runtime state.

### Primary entities

- AuditEvent
- ModerationCase operational state
- Report / Appeal workflow state
- Job
- Retry
- DLQ
- Outbox
- Inbox
- Operational idempotency records
- Recovery operation state
- Reconciliation operation state
- Platform runtime state

### Invariants

- D1-03 is not a generic business-data sink.
- Audit records are append-oriented or controlled-state records and cannot be silently rewritten by ordinary business flows.
- Runtime/job state does not become business authority.
- Analytics and operational projections do not become identity, content or financial authority.

## 7. D1-04 — Commerce / Financial Authority

### Authority

D1-04 owns durable commercial state and authoritative financial facts.

### Primary entities

- Merchant / Seller
- Product / ProductVersion / Catalog commercial state
- Cart / Checkout
- Order / Invoice
- PaymentIntent / Payment transaction state
- Refund
- Chargeback
- Wallet
- LedgerEntry
- RevenueShare
- CreatorEarnings
- PayableReserve
- SettlementBatch / Settlement
- Payout
- Tax / FinancialRecord
- Currency / financial precision metadata where persistence is required

### Financial invariants

- LedgerEntry is the authoritative financial fact.
- Ledger entries are immutable; corrections use compensating/reversal entries.
- Wallet is a derived or controlled account view and is reconciled against ledger invariants.
- Order and payment state require deterministic idempotency and reconciliation.
- No remote counter mutation may represent a financial effect.
- Financial effects must be independently auditable.

## 8. Subscription / Entitlement boundary

Subscription and membership access authority belongs to D1-01.

Payment/order/financial authority belongs to D1-04.

Representative flow:

```text
D1-04 Payment / Order
        ↓
validated event
        ↓
D1-01 Entitlement transition
        ↓
Access decision
```

No cross-D1 distributed transaction is assumed.

## 9. Advertising boundary

Advertising is not a fifth D1 and advertising business state does not automatically belong to D1-04.

Campaign, creative, targeting, delivery and operational advertising state remain with their owning Blueprint domain.

Only authoritative financial effects, including reconciled spend, billing, revenue, payable and settlement effects, enter D1-04 as financial records.

Every financial posting must retain an auditable reference to its originating advertising source/event.

## 10. Cross-domain transaction rule

Same-domain atomicity is allowed only where the contract explicitly defines the invariant.

Cross-domain mutation must not rely on a distributed database transaction.

Canonical pattern:

```text
Authoritative transaction
        ↓
Outbox / event
        ↓
Queue / consumer
        ↓
Idempotent state transition
        ↓
Reconciliation / evidence
```

Events are integration mechanisms and never replace the owning domain's source of truth.

## 11. Cross-domain reference rules

1. Every authoritative entity has exactly one primary D1 owner.
2. Foreign ownership remains with the authoritative domain.
3. Consumers may store stable references or snapshots required for their own query semantics.
4. A reference/snapshot never silently becomes authoritative.
5. Cross-domain joins are not assumed to be one atomic D1 transaction.
6. Event payloads use versioned contract data and correlation/idempotency identifiers.
7. Deletion and erasure semantics are governed by the owning domain and propagated explicitly.

## 12. Worker / D1 security boundary

- Every D1 writer is scoped to its authorized domain and operation.
- No unrestricted cross-domain database writer exists.
- Worker credentials must not imply authority over every D1.
- Authorization is evaluated before authoritative mutation.
- Financial mutations require elevated scoped authorization, idempotency, auditability and reconciliation.
- W01 API/Gateway is not a universal database writer.
- W10 asynchronous execution does not become a second D1-03 authority.
- W12 integration execution does not become a second T24 or universal D1 authority.

## 13. Projection boundaries

The following are never authoritative replacements for the owning D1:

- Cache
- Feed projections
- Recommendation results
- Search indexes
- Analytics projections
- Operational snapshots
- Consumer-side replicas of business state

## 14. Provider portability

The logical model is provider-neutral.

Cloudflare D1 is the initial relational provider. PostgreSQL/GCP migration must preserve:

- canonical IDs
- entity ownership
- financial immutability
- transaction invariants
- event ordering/version semantics
- idempotency identity
- audit traceability

Provider-specific SQL/storage behavior must not become part of the business authority contract.

## 15. Payload boundary

Payload Core remains immutable.

Payload may be used only through supported extension points. It must not be forked, patched, copied or treated as a generic business-code container.

## 16. Historical topology disposition

The following remain historical evidence and do not override this Master:

- Legacy W00-W08 / D1-01-D1-03 topology
- Legacy W01-W13 topology
- Legacy W00 generic business-writer assumptions
- Legacy contracts that bind payment/idempotency records to the previous D1 model
- Any implementation that infers D1 ownership from Payload Collections, routes or directory names

Historical records are preserved for auditability and migration analysis.

## 17. Required downstream mapping

The following chain is mandatory before Contract GREEN:

```text
Feature
  → Task
  → Primary Worker
  → Primary D1
  → API
  → Data
  → Security
  → Event
  → Test
  → Evidence
```

Missing or conflicting links are not GREEN.

## 18. Change control

Any proposed change to:

- D1 count
- D1 identity
- primary entity ownership
- financial authority
- cross-domain transaction semantics
- Worker/D1 write authority

requires explicit architecture change control and must not be introduced through implementation code.

## 19. Gate status

```text
Blueprint topology target      = 12 Workers / 4 D1 / 25 Tasks
D1 domain definition           = FROZEN
D1 entity ownership baseline   = FROZEN
Cross-D1 transaction rule      = FROZEN
Financial authority            = FROZEN to D1-04
Subscription/access authority  = FROZEN to D1-01
Historical topology            = HISTORICAL
Worker → D1 binding             = NEXT
Mapping Freeze                 = BLOCKED until binding/audit
Contract generation            = BLOCKED until Mapping Freeze
Implementation                 = NOT AUTHORIZED until Contract gates pass
```
