# LuckRead Merchant / Seller Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authoritative Entities

```text
Merchant
Store
MerchantQualification
MerchantStaff
MerchantScope
FulfillmentProfile
MerchantPolicyState
```

## 2. Core Fields

### Merchant

```text
merchantId
merchantType
status
displayName
identityRef
verificationRef
primaryStoreId
version
createdAt
updatedAt
```

### Store

```text
storeId
merchantId
name
status
profileRef
locale
region
version
createdAt
updatedAt
```

### Staff

```text
staffId
merchantId
userId
role
scope
status
version
createdAt
updatedAt
```

## 3. Constraints

- `merchantId` and `storeId` are immutable identifiers.
- A store has one authoritative merchant owner at a time.
- Staff membership is unique by merchant/user active relationship.
- Scope is explicit and deny-by-default.
- Status transitions are versioned and auditable.
- Derived performance metrics are not authoritative merchant data.

## 4. Privacy / Retention

Identity evidence is represented by references, not copied into ordinary merchant records. Sensitive evidence follows least-retention principles and is excluded from public DTOs.

## 5. Rebuild

Operational read models may be rebuilt from authoritative Merchant/Store/Staff state and domain events.

## 6. Storage

Logical owner: W07 / D1-04. Approved PostgreSQL schema target: Neon `luckread_finance`.

The shared migration ledger currently records D1-04 runner status as NOT_IMPLEMENTED and remoteApplyReady=false. The existing D1-04 manifest contains order/payment schema only; Merchant/Seller entities are not yet present. Do not infer Merchant/Seller runtime persistence or production authority from the presence of W07 Neon configuration.

Production storage authority remains an evidence-controlled deployment fact. Until separately verified and approved, no production data mutation, remote DDL, cutover or dual-write is authorized.

```text
W07 = sole logical Merchant/Seller owner
W01 = public API ingress
W08 = authorization boundary
Neon luckread_finance = approved schema target
D1 = retain only the currently admitted production path pending verified cutover
R2 = controlled evidence/media objects
Cache/KV = derived projections only
W10 = admitted asynchronous execution only
```

No new D1 binding/fallback, database, Worker, Queue or Service Binding may be introduced.