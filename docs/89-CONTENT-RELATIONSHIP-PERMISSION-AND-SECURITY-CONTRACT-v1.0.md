# LuckRead Content Relationship Permission & Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authorization Chain

```text
Authentication
→ Actor
→ App / Session Context
→ Resource Scope
→ Owner / Creator / Organization Scope
→ Relationship Policy
→ Rights Check when required
→ Mutation
→ Audit
```

## 2. Permission Classes

### Read
- public relationship read
- owner relationship read
- private relation read
- restricted/admin read

### Write
- create relationship
- change attribution
- revoke relationship
- create derivative relation
- attach to series/collection/IP

### Administrative
- dispute handling
- relation quarantine
- provenance correction under governed procedure
- bulk relation operations

## 3. Security Invariants

1. Relationship existence never grants legal usage rights.
2. A creator cannot impersonate another creator through relationship fields.
3. Actor/owner IDs are derived from trusted server context.
4. Private source/target visibility is enforced before relation disclosure.
5. Cross-organization operations require explicit scope.
6. External apps use least-privilege scopes.
7. Sensitive provenance evidence is never returned through ordinary public DTOs.
8. Bulk mutations require idempotency, confirmation and audit.
9. Replayed commands cannot create duplicate authoritative relations.

## 4. Abuse Protection

Protect against:

```text
relationship spam
mass repost graph creation
fake attribution
provenance poisoning
unauthorized remix
relation enumeration
privacy leakage
```

Apply authentication, authorization, rate limits, anomaly/risk checks and audit as appropriate. Risk decisions remain owned by Risk/Trust.

## 5. Audit

At minimum:

```text
actorId
action
sourceRef
targetRef
relationType
before/after summary
requestId
correlationId
timestamp
result
```
