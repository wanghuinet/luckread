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

Cloudflare-first default:

```text
D1 = authoritative structured state
R2 = large merchant assets/evidence references where required
Cache/KV = derived hot views only
```
