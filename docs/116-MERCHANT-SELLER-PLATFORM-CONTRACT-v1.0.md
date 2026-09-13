# LuckRead Merchant / Seller Platform Contract v1.0

**状态：CAPABILITY-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**  
**定位：L1-08 Merchant / Seller Platform**

## 1. 定位

Merchant / Seller Platform 负责商家、店铺、经营主体、商品经营资格、履约配置与商家运营关系。

它不是 Commerce Order 的第二权威，也不拥有 Payment、Ledger、Creator、Rights 或 Product Content 的事实。

```text
Merchant           = seller / merchant authority
Commerce           = product/offer/order/entitlement authority
Payment            = external payment fact boundary
Ledger             = financial fact authority
Creator            = creator authority
Rights             = legal rights authority
```

## 2. L1-L4 能力模型

### L2-01 Merchant Identity
- L3 Merchant Profile
  - L4 merchantId
  - L4 legal/business identity reference
  - L4 display name
  - L4 business category
- L3 Merchant Type
  - L4 individual
  - L4 business
  - L4 brand
  - L4 organization
  - L4 service provider
- L3 Lifecycle
  - L4 pending
  - L4 active
  - L4 restricted
  - L4 suspended
  - L4 closed

### L2-02 Seller Qualification
- L3 Verification
  - L4 business verification reference
  - L4 identity evidence reference
  - L4 tax/compliance reference
- L3 Capability
  - L4 sell digital goods
  - L4 sell physical goods
  - L4 subscription
  - L4 creator affiliate
  - L4 live commerce
- L3 Qualification Lifecycle
  - L4 review
  - L4 approved
  - L4 denied
  - L4 expired
  - L4 re-review

### L2-03 Store Management
- L3 Store Identity
  - L4 storeId
  - L4 owner reference
  - L4 store status
- L3 Store Profile
  - L4 name
  - L4 logo
  - L4 description
  - L4 contact reference
- L3 Store Operations
  - L4 open
  - L4 pause
  - L4 resume
  - L4 close

### L2-04 Merchant Staff & Delegation
- L3 Staff
  - L4 invite
  - L4 role
  - L4 activation
  - L4 removal
- L3 Roles
  - L4 owner
  - L4 admin
  - L4 operator
  - L4 finance
  - L4 customer service
  - L4 analyst
- L3 Scope
  - L4 store scope
  - L4 product scope
  - L4 order scope
  - L4 settlement-view scope

### L2-05 Product Operating Relationship
- L3 Catalog Binding
  - L4 product reference
  - L4 SKU reference
  - L4 category reference
- L3 Offer Relationship
  - L4 price reference
  - L4 promotion reference
  - L4 entitlement reference
- L3 Content Commerce Binding
  - L4 content reference
  - L4 creator/IP reference
  - L4 live/product reference

### L2-06 Fulfillment Configuration
- L3 Digital Fulfillment
  - L4 entitlement delivery reference
  - L4 access delivery state
- L3 Physical Fulfillment
  - L4 fulfillment provider reference
  - L4 shipping policy reference
  - L4 return policy reference
- L3 Service Fulfillment
  - L4 service delivery reference
  - L4 completion state

### L2-07 Merchant Operations
- L3 Order View
  - L4 pending order reference
  - L4 paid order reference
  - L4 refund reference
- L3 Customer Service
  - L4 inquiry reference
  - L4 dispute reference
  - L4 resolution reference
- L3 Performance
  - L4 GMV/reference
  - L4 conversion reference
  - L4 fulfillment performance

### L2-08 Merchant Governance
- L3 Policy
  - L4 merchant policy state
  - L4 restricted category reference
- L3 Risk
  - L4 merchant risk reference
  - L4 fraud/compliance signal reference
- L3 Audit
  - L4 actor
  - L4 action
  - L4 target
  - L4 timestamp
  - L4 result

## 3. Authority Rules

Merchant Platform owns:

```text
merchant identity
merchant lifecycle
seller qualification
store ownership
merchant staff/delegation
merchant operating configuration
fulfillment configuration reference
```

It does not own:

```text
Product canonical fact
Order final state
Payment provider fact
Ledger balance
Creator identity
Legal rights
Recommendation ranking
```

## 4. Runtime Boundary

Cloudflare-first:

```text
Workers
→ D1 authoritative merchant/store state
→ R2 merchant media where required
→ Queues async operational events
→ Cache/KV hot seller/store projections
```

External commerce engines are adapters only and cannot become platform-wide merchant authority without an explicit contract revision.

## 5. API Boundary

```text
/v1/merchants
/v1/merchants/:id
/v1/merchants/:id/qualification
/v1/merchants/:id/stores
/v1/stores/:id
/v1/stores/:id/staff
/v1/stores/:id/products
/v1/stores/:id/operations
/v1/stores/:id/fulfillment
```

All mutations require authentication, authorization, scope, idempotency, concurrency protection, stable error model and audit where sensitive.

## 6. Event Boundary

At minimum:

```text
merchant.created
merchant.updated
merchant.qualification.submitted
merchant.qualification.approved
merchant.qualification.rejected
merchant.suspended
store.created
store.updated
store.paused
store.closed
merchant.staff.invited
merchant.staff.role_changed
merchant.staff.removed
merchant.fulfillment.updated
merchant.restricted
merchant.reinstated
```

Events use versioned envelopes and at-least-once delivery with deduplication, retry, DLQ and replay.

## 7. Security

```text
Actor
→ Session/App Scope
→ Merchant Scope
→ Store Scope
→ Role/Permission
→ Policy/Risk Check
→ Mutation
→ Audit
```

External apps receive least-privilege merchant/store scopes. Sensitive business evidence is never exposed in ordinary public APIs.

## 8. Acceptance

P0 must verify:

1. Merchant can be created and identified uniquely.
2. Qualification controls selling capabilities.
3. Store belongs to exactly the authorized merchant scope.
4. Staff roles cannot exceed assigned scope.
5. Product/order APIs consume merchant references without duplicating merchant authority.
6. Fulfillment configuration changes are auditable.
7. Suspended merchants cannot perform restricted mutations.
8. Repeated mutations are idempotent.
9. External commerce adapter cannot become hidden authority.
10. D1 remains authoritative for merchant/store metadata.
11. No Payload Core source is modified or copied.

## 9. STOP

- duplicate merchant authority
- order state stored as merchant state
- payment or ledger balance stored here
- unscoped staff access
- qualification bypass
- external adapter becomes hidden source of truth
- non-idempotent staff/merchant mutations
- sensitive evidence leakage

## 10. Status

```text
CAPABILITY = COMPLETE
CONTRACT = READY
IMPLEMENTATION = PENDING
```
