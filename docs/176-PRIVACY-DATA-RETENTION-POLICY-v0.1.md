# LuckRead Privacy / Data Retention Policy v0.1

**Status:** GOVERNANCE BASELINE / PRE-LAUNCH / NOT PUBLIC FINAL POLICY  
**Version:** 0.1  
**Owner:** LuckRead governance owner  
**Policy Class:** PRIVACY / DATA RETENTION  
**Related Contracts:** PRIV-004, PRIV-002, DATA LIFECYCLE / RETENTION / ERASURE  
**Effective Scope:** Repository governance baseline; applies to data-lifecycle design and implementation decisions until superseded.

## 1. Purpose

This document establishes the initial privacy and data-retention governance baseline for LuckRead.

It is intentionally a **pre-launch policy baseline**. It defines the control model, data classes, lifecycle rules, and versioning requirements without inventing jurisdiction-specific legal requirements or concrete retention periods.

Before public APP/website launch, this policy must be reviewed against the actual product data flows, third-party services, applicable user regions, and final legal/compliance requirements. A later version may replace this baseline through normal policy versioning and approval.

This document is not, by itself, the concrete PRIV-004 policy instance required to calculate a runtime `retentionUntil`.

## 2. Core Principles

LuckRead follows these baseline principles:

1. **Purpose limitation** — collect and retain data for defined product, security, operational, financial, legal, or user-request purposes.
2. **Data minimization** — collect the minimum data reasonably required for the intended purpose.
3. **Retention limitation** — data must not receive an implicit permanent lifetime merely because storage is inexpensive.
4. **Authoritative policy** — retention behavior is determined by an approved policy, not by a client request.
5. **Versioned policy** — policy changes create a new policy version when the retention meaning changes.
6. **Auditable decisions** — material privacy and retention changes require owner, scope, approval, effective period, and provenance.
7. **Fail closed** — when a runtime operation requires a retention decision but no applicable approved policy can be resolved, the system must not invent a retention value.
8. **Lifecycle consistency** — source records, derived data, caches, exports, media objects, and backups must converge according to their applicable lifecycle rules.
9. **Legal hold precedence** — an active legal hold can prevent normal purge for the held scope until the hold is released or expires.
10. **No second business authority** — domain systems own the business meaning of data; the lifecycle/policy layer defines retention and disposal behavior.

## 3. Data Classification Baseline

The following classes are the initial governance taxonomy. Exact records and durations are determined by their applicable contracts and approved policy instances.

| Data area | Typical examples | Initial retention class |
|---|---|---|
| Account / Identity | account profile, account state, registration envelope | BUSINESS / LEGAL_AUDIT where required by the related contract |
| Credentials | password/authentication material, credential metadata | SECURITY |
| Consent / Privacy | consent records, withdrawal history, policy references | LEGAL_AUDIT |
| Content | articles, media metadata, publishing state | BUSINESS |
| Transactions / Finance | orders, payments, settlement records | FINANCIAL |
| Security / Audit | security events, audit evidence, abuse/risk records | SECURITY / LEGAL_AUDIT |
| Analytics | aggregated or product analytics data | ANALYTICS |
| Derived / Cache | search indexes, recommendation projections, cache/KV materializations | DERIVED |
| Backup | backup copies and recovery artifacts | BACKUP |

A concrete resource may use a more specific class or lifecycle rule when its owning contract requires it.

## 4. Required Retention Metadata

Where lifecycle management applies, the authoritative record should be able to resolve or reference:

```text
resourceId
resourceType
ownerSubjectId
retentionClass
policyVersion
sourceAuthority
retentionUntil (where applicable)
legalHoldRef (nullable)
lifecycleState
createdAt
updatedAt
deletedAt (where applicable)
```

`retentionUntil` is server-controlled when required by the resource contract.

Clients must not select, extend, shorten, or override a retention rule through ordinary API input.

## 5. Retention Policy Resolution

Retention resolution follows this conceptual sequence:

```text
resource / purpose
→ retention class
→ authoritative policy scope
→ effective policy version
→ deterministic rule evaluation
→ retentionUntil
→ lifecycle enforcement
```

An approved policy instance must have a deterministic rule. LuckRead must not infer a duration from unrelated defaults, neighboring domains, implementation convenience, or previously used values.

Until such an instance is approved, affected runtime paths remain fail-closed.

## 6. Consent Data

Consent records are governed as first-class privacy records.

For registration consent, the current contract binding is:

```text
purpose       = ACCOUNT_REGISTRATION
legalBasis    = CONSENT
state         = GRANTED initially
retentionClass = LEGAL_AUDIT
policyVersion = immutable reference
retentionUntil = server-calculated
```

Withdrawal must remain durable and auditable according to the PRIV-002 consent contract.

This policy does not assign a concrete consent retention duration.

## 7. User Rights and Lifecycle Operations

Where applicable to a product flow and legal context, LuckRead must support controlled handling of:

- access / export requests;
- correction;
- deletion requests;
- restriction or equivalent lifecycle state;
- anonymization where deletion is not permitted;
- retention expiry;
- legal hold.

A deletion request is a durable lifecycle operation rather than a promise that all data disappears synchronously from every system.

The expected lifecycle is:

```text
request
→ scope evaluation
→ authorization
→ legal-hold check
→ source mutation
→ derived-data propagation
→ verification
→ finalization
```

## 8. Derived Data, Cache, Media and Backup

Deleting or expiring a source record must not leave an indefinitely usable business projection in a derived system.

Relevant downstream categories include:

```text
search index
recommendation features
analytics projections
cache / KV
materialized views
R2/media objects
exports
backups
```

Each downstream system may have its own technical propagation delay, but its lifecycle must ultimately be governed by the authoritative source and applicable policy.

Backups are not an exemption from deletion governance. Backup retention is itself a policy-controlled lifecycle.

## 9. Legal Hold

An active legal hold blocks automated purge for the held scope.

At minimum, a legal hold should be traceable through:

```text
holdId
scope
reason
authority
createdAt
expiresAt (nullable)
releaseActor
releasedAt
```

The application must not silently purge held data.

## 10. Third-Party and External Services

Before public launch, every external service that receives LuckRead-controlled data must be mapped to:

- purpose of disclosure;
- data categories;
- owner / processor role as applicable;
- transfer/storage location where relevant;
- retention behavior;
- deletion/erasure mechanism;
- contractual or policy basis;
- audit/provenance source.

This includes, where actually used, analytics, advertising, payments, communications, identity integrations, storage, monitoring, and content-delivery services.

No third-party service should be treated as an implicit permanent archive.

## 11. Security and Access

Privacy and retention controls are security-sensitive.

Operations that read, export, alter, retain, release, or purge sensitive data must be subject to:

```text
authentication
→ scope / role check
→ resource authorization
→ lifecycle / policy check
→ audit
```

Sensitive configuration, policy approvals, credentials, and access tokens must not be stored in public DTOs or committed as plaintext secrets.

## 12. Policy Versioning

Material changes to retention semantics must create a new policy version.

A policy version should identify at least:

```text
policyId
policyVersion
owner
scope
environment
status
effectiveFrom
effectiveTo
rollbackVersion
approvalRef
sourceAuthority
provenance
```

Historical records that require interpretability must retain the policy version that governed their lifecycle decision.

A later APP/website launch policy may therefore supersede v0.1 without rewriting historical decisions.

## 13. Pre-Launch Review Gate

Before public APP/website launch, this baseline must be re-reviewed against the actual product.

The review must reconcile at least:

1. actual account and authentication data flows;
2. consent and privacy UI;
3. cookies / local storage / SDK behavior where applicable;
4. analytics and telemetry;
5. advertising and attribution, if enabled;
6. payments and financial records, if enabled;
7. content/media storage and deletion behavior;
8. security and abuse logs;
9. export / deletion request workflows;
10. third-party processors and data transfers;
11. user-region / jurisdiction requirements;
12. concrete retention durations and approved policy instances.

The resulting launch-ready version may be v0.2, v0.3, or v1.0 depending on change scope.

## 14. Explicit Non-Decisions

This v0.1 baseline intentionally does **not** decide:

- a universal number of days or years for any privacy dataset;
- a jurisdiction-specific legal retention requirement;
- a permanent retention rule;
- a specific legal basis for a future feature that has not yet been implemented;
- a public-facing privacy notice;
- the final set of third-party processors;
- a concrete PRIV-004 `ACCOUNT_REGISTRATION / LEGAL_AUDIT` policy instance.

Those decisions require their own authoritative product, legal/compliance, approval, and evidence inputs.

## 15. Relationship to PRIV-004 and AUTH-001

This policy is the **governance framework** supporting PRIV-004.

It does not satisfy the current PRIV-004 instance-admission gate.

Therefore:

```text
Privacy / Data Retention Policy v0.1
        ↓
governance baseline
        ↓
concrete approved PRIV-004 policy instance
        ↓
deterministic retentionUntil
        ↓
AUTH-001 runtime admission
```

Until the concrete instance exists, AUTH-001 must remain fail-closed with respect to `ENT-CONSENT.retentionUntil`.

## 16. Change Control

Changes to this policy must:

- increment the policy version when semantics materially change;
- identify the reason and affected scope;
- retain approval and provenance;
- define effective timing;
- identify rollback/retirement handling;
- reconcile dependent contracts before runtime behavior changes.

This document can therefore be revised before APP/website launch without rewriting the current contractual history.

## 17. Evidence and Acceptance

This v0.1 document is accepted only as a **governance baseline**.

Acceptance does not mean:

- a legal compliance certification;
- a final public privacy notice;
- a concrete retention-period approval;
- AUTH-001 runtime authorization;
- Mapping 0 GREEN.

Concrete runtime adoption requires the separate PRIV-004 policy-instance admission and subsequent Evidence Registry checks.
