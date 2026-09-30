# LuckRead Four-D1 Domain Master Change-Control Proposal v1.0

**Status: PROPOSED / PENDING CHANGE-CONTROL APPROVAL**

## 1. Purpose

This proposal converts the completed historical D1 reverse audit and D1-04 candidate entity diff into an explicit four-domain ownership proposal.

It does **not** freeze the proposal. No implementation, Worker ownership, or contract generation may treat this document as authoritative until approved through architecture change control.

Canonical authority remains:
- Functional Blueprint: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Architecture Blueprint: `docs/00-PROJECT-BLUEPRINT-v1.4.md`
- Contract Mapping: `docs/02-FINAL-MAPPING-v1.0.md`

## 2. Frozen topology target

- Workers: 12
- D1 domains: 4
- Contract Tasks: 25

No fifth D1 domain may be introduced implicitly.

## 3. Proposed D1 domains

| Domain | Proposed authority | Primary responsibility | Status |
|---|---|---|---|
| D1-01 | Identity / Account / Access | User, Identity, Credential, Session, Role, Entitlement, Subscription, Organization and account lifecycle state | PROPOSED |
| D1-02 | Content / Community Data | Content, Revision, Media metadata, Comment and content-domain interaction state | PROPOSED |
| D1-03 | Platform Operations | Audit, moderation operations, jobs, outbox/inbox, operational idempotency and system recovery state | PROPOSED |
| D1-04 | Commerce / Financial Authority | Merchant commerce state, Order, Payment, Invoice, Refund, Wallet, Ledger, Revenue, Settlement, Payout and financial records | PROPOSED |

## 4. Authoritative write rules

### D1-01

Authoritative writes are limited to account/access lifecycle and entitlement authority. Subscription remains here because it participates directly in entitlement and authorization state.

### D1-02

Authoritative writes are limited to content/community-domain state. Financial facts, account authority, and operational recovery state must not be written here as authoritative state.

### D1-03

Authoritative writes are limited to operational/system state. Audit and recovery records are append-oriented or controlled-state records. D1-03 must not become a generic business-data sink.

### D1-04

Financial authority is concentrated here. Ledger entries are immutable financial facts; wallet balances are derived or controlled account views reconciled against ledger invariants. Orders and payment state remain durable commercial authority and must have deterministic reconciliation semantics.

## 5. Entity placement proposal

### D1-01

- User
- Identity
- Credential
- Session
- Role / RoleAssignment
- Entitlement
- Subscription / Membership access state
- Organization
- Organization membership / invitation / team
- Creator identity/profile and identity-linked verification state

### D1-02

- Content
- Article / Gallery / Video / Audio / Live metadata
- Revision
- Media metadata/reference records
- Comment / Reply
- Share and content-interaction records where the Blueprint assigns them to content/community state

### D1-03

- AuditEvent
- ModerationCase operational state
- Report / Appeal workflow state where operational governance is authoritative
- Job / Retry / DLQ records
- Outbox / Inbox records
- Operational idempotency records
- Recovery / reconciliation operation state

### D1-04

- Merchant / Seller
- Product / ProductVersion / Catalog commercial state
- Cart / Checkout
- Order / Invoice
- PaymentIntent / Payment transaction state
- Refund / Chargeback financial effects
- Wallet
- LedgerEntry
- RevenueShare / CreatorEarnings / PayableReserve
- SettlementBatch / Settlement
- Payout
- Tax / FinancialRecord
- Currency / financial precision metadata where persistence is required

## 6. Advertising boundary

Advertising business state does not automatically become D1-04.

Campaign, Creative, Targeting, Delivery and operational ad state remain in their owning business domain according to the Blueprint and Mapping.

Only authoritative financial effects such as reconciled ad spend, billing postings, payable/revenue effects, or settlement effects cross into D1-04.

The financial posting must reference its originating advertising event/source and remain independently auditable.

## 7. Transaction boundaries

### Same-domain atomicity

A transaction may atomically modify multiple entities only when they belong to the same D1 domain and the contract defines the invariant.

### Cross-domain mutation

A request must not rely on a distributed database transaction across D1 domains.

Cross-domain changes use:

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

### Financial invariant

A financial effect cannot be represented by a remote counter mutation. It must create an auditable D1-04 financial record and, where applicable, a compensating/reversal record rather than in-place mutation.

## 8. Cross-domain references

Cross-domain relationships use stable canonical IDs and explicit references only.

Rules:

1. Foreign ownership remains with the authoritative domain.
2. A consuming domain may store a reference/snapshot required for its own query semantics, but may not silently become authoritative.
3. Cross-domain joins are not assumed to be available as a single D1 transaction.
4. Event payloads carry versioned contract data and correlation/idempotency identifiers.
5. Deletion/erasure semantics are governed by the owning domain and propagated through explicit events.

## 9. Event boundaries

Representative flows:

```text
D1-01 Subscription/Entitlement
        → entitlement/payment decision event
        → D1-04 payment/order effects where applicable

D1-02 Content purchase target
        → D1-04 order/payment
        → D1-01 entitlement activation

D1-04 Payment/Refund
        → D1-01 entitlement transition
        → D1-03 audit/reconciliation evidence

D1-04 Creator earnings
        → D1-03 operational payout/reconciliation workflow
```

Events are integration mechanisms, not a second source of truth.

## 10. Security boundary

- Every D1 writer is scoped to its domain.
- No unrestricted cross-domain DB writer.
- Worker credentials must not imply authority over every D1 domain.
- Authorization is evaluated before authoritative mutation.
- Financial mutations require elevated scoped authorization, idempotency, auditability and reconciliation.
- Audit records cannot be modified by ordinary business flows.
- Cache and analytics projections never become authoritative.

## 11. Migration boundary

The logical model is provider-neutral.

Cloudflare D1 is the initial implementation provider. The domain model must remain portable to PostgreSQL/GCP without changing business authority semantics.

Migration must preserve:

- canonical IDs
- entity ownership
- financial immutability
- event ordering/version semantics
- idempotency identity
- audit traceability
- transaction invariants

Provider-specific SQL or storage behavior must not become part of the business contract.

## 12. Conflict findings requiring approval

The following historical assumptions remain non-authoritative until reconciled:

1. Legacy W00-W08 / D1-01-D1-03 topology.
2. Legacy W01-W13 topology.
3. Legacy contracts assigning W00 as a generic business writer.
4. Legacy payment/idempotency contracts referring to D1-01/D1-03 operational records.
5. Any implementation that infers D1 ownership from Payload Collections, routes, or directory names.

These records remain historical evidence and must not silently override the current 12/4/25 target.

## 13. Approval invariants

Approval requires all of the following:

- exactly four canonical D1 domains;
- every authoritative entity has exactly one primary D1 owner;
- every financial authority entity belongs to D1-04 unless an explicit Blueprint exception is approved;
- Subscription/Entitlement ownership is explicitly resolved;
- no cross-domain unrestricted writer exists;
- every cross-domain mutation has event/idempotency semantics;
- Mapping contains Feature → Task → Worker → D1 → API → Data → Security → Event → Test → Evidence;
- legacy topology is marked historical rather than silently reused;
- Payload Core remains immutable and is not treated as a generic business-code container;
- Cloudflare-to-PostgreSQL portability remains an explicit invariant.

## 14. Gate

```text
D1 candidate entity diff       = COMPLETE
4-D1 domain proposal           = COMPLETE
Change-control approval        = PENDING
Canonical D1 Master             = BLOCKED until approval
Worker → D1 binding             = BLOCKED until canonical D1 Master
Mapping Freeze                  = BLOCKED
Contract generation             = BLOCKED
Implementation                  = NOT AUTHORIZED
```

## 15. Next required artifact

After approval, produce:

`docs/09-D1-DOMAIN-MASTER-v1.0.md`

That document becomes the canonical machine-readable-compatible D1 ownership baseline and is followed by Worker → D1 binding, entity/data mapping, API/data/security/event mapping, conflict/orphan/duplicate audit, and Mapping Freeze.
