# Luckread Blueprint Pass 04 — User Full Lifecycle Matrix v1.0

> Status: **CLOSURE PASS 04 / BLUEPRINT ONLY**
> Scope: complete user/account lifecycle coverage before Contract-First implementation.
> Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` plus the completeness closure and dependency matrix.
>
> This document does not implement code. It closes lifecycle requirements and identifies the Feature IDs that must participate in each user journey.

## 1. Objective

A user capability is not considered functionally complete merely because registration and profile CRUD exist. The platform must define the complete lifecycle from discovery and account creation through identity, authorization, creation, interaction, monetization, support, security events, data portability, deletion, and possible restoration.

## 2. Lifecycle state model

The canonical account lifecycle is:

`anonymous → registration_started → verification_pending → active → restricted/suspended → restored OR terminated → deletion_pending → deleted`

Additional orthogonal states must not be collapsed into account status:

- identity verification state
- age/child-safety state
- creator verification state
- organization membership state
- subscription/entitlement state
- payment state
- moderation/risk state
- security/session state
- privacy/consent state

A state transition must have an authoritative actor, reason where required, timestamp, audit record, and notification behavior where applicable.

## 3. Lifecycle matrix

| Stage | Capability | Feature IDs | Required dependencies | Closure requirements |
|---|---|---|---|---|
| Discovery | guest access/onboarding | CLIENT-001/002, GROWTH-001, FEED-008, SEO-001..010 | public content/discovery | no account required for allowed public journeys |
| Registration | account creation | AUTH-001, AUTH-003 | API-001..008, SAFETY-004/008 | uniqueness, rate limits, anti-enumeration, audit |
| Verification | email/phone verification | AUTH-005 | NOTIFY-003/004, JOB-003 | expiring, single-use, non-replayable verification |
| Credentials | password/session lifecycle | AUTH-004, AUTH-010, AUTH-011 | SEC-003, API-007 | revocation and rotation are authoritative |
| Consent | terms/privacy/age | PRIV-001..008, AUTH-016 | GOV-006, SAFETY-013 | versioned consent and regional rules |
| Profile | profile/preferences/privacy | USER-001..006 | AUTHZ-005 | server-owned fields protected |
| Personal history | activity/history/export | USER-007, USER-010, DATA-006/009/010 | PRIV, DATA | export/delete semantics explicit |
| Social | follow/like/comment/bookmark/share | SOCIAL-001..010 | AUTHZ, SAFETY, NOTIFY | relationship and abuse controls |
| Community | groups/channels/events | COMMUNITY-001..008 | AUTHZ, GOV, SAFETY | moderator scope and enforcement |
| Creator transition | creator profile/verification/workspace | CREATOR-001..007, AUTH-016 | AUTHZ, ORG | approval and ownership boundaries |
| Organization | team/MCN membership | ORG-001..007, TENANT-001..008 | AUTHZ-006 | scoped access and audit |
| Content creation | draft/revision/review/publish | CONTENT-001..012, ARTICLE-001..012, MEDIA-001..015 | CREATOR, AUTHZ, JOB, SAFETY | lifecycle, moderation, ownership, audit |
| Discovery participation | feed/search/recommendation | FEED-001..013, REC-001..009, SEARCH-001..010 | content state, safety, analytics | eligibility and negative feedback honored |
| Monetization | subscription/paywall/purchase | MON-001..012, AUTHZ-003/004 | PAY, CONTENT | entitlement is server authoritative |
| Payment | order/refund/chargeback | PAY-001..013 | MON, SEC, DATA | idempotency, ledger, audit, reconciliation |
| Creator revenue | revenue/split/settlement | PAY-007..011, ORG-005/006 | PAY, CREATOR, ORG | immutable financial records and settlement controls |
| Advertising | advertiser exposure/attribution | ADS-001..015 | AUTHZ, PAY, ANALYTICS, SAFETY | policy, frequency, attribution, settlement |
| Notifications | in-app/push/email | NOTIFY-001..008 | JOB, USER preferences | retry/dedupe/preferences/quiet hours |
| Security event | suspicious login/risk/enforcement | AUTH-012/013, SAFETY-004..012 | SEC, GOV, OBS | evidence, audit, appeal where applicable |
| Support | help/ticket/escalation | SUPPORT-001..006 | AUTH, GOV, PAY | identity-aware access and SLA |
| Recovery | account recovery | AUTH-014 | AUTH-005, NOTIFY, SEC | recovery must not bypass authorization |
| Restriction | suspend/ban/freeze | AUTH-013, SAFETY-010 | GOV, AUTHZ | protected mutation blocked; reason/audit |
| Restoration | restore eligible account/data | AUTH-015, GOV-005 | DATA, SUPPORT | policy-driven restoration, audit |
| Deletion | user-requested deletion | USER-010, AUTH-015, DATA-007..010 | PRIV, PAY, CONTENT, MEDIA | dependency-aware deletion and retention |
| Legal hold | preserve required records | DATA-007, GOV-004, PRIV-005 | audit/legal policy | legal hold overrides ordinary deletion only where required |
| Termination | final account closure | AUTH-015, DATA-009 | PAY, RIGHTS, CONTENT, STORAGE | orphaned ownership and entitlement rules resolved |

## 4. User journey acceptance

### 4.1 Anonymous → active

The journey must support:

`discover → register → verify → consent → credential/session creation → profile initialization → onboarding → active`

Required controls:

- registration cannot create duplicate identities under concurrent requests;
- verification cannot be replayed;
- security secrets are never returned through profile APIs;
- consent versions are retained;
- account status is server authoritative;
- onboarding is resumable where appropriate.

### 4.2 Active → creator

`active user → creator application/eligibility → verification → creator profile → creator workspace → publish`

Creator privileges must not be inferred from client claims. Creator, MCN, organization, and monetization privileges require explicit authorization and audit.

### 4.3 Active → subscriber/customer

`active user → plan/product → checkout → order → payment → entitlement → content access`

For partial paywall content, the entitlement boundary must be explicit. Example: a public article may expose its free portion while the protected portion requires an active entitlement.

### 4.4 Customer → cancellation/refund

`entitled → cancel/pause → entitlement transition → access policy → refund where applicable → financial reconciliation`

Cancellation must not silently rewrite historical orders or ledger records.

### 4.5 Creator → revenue

`published content → eligible monetization → revenue event → ledger → creator/MCN split → settlement → payout → tax record`

Every monetary transition requires idempotency, traceability, reconciliation, and immutable historical evidence.

### 4.6 Active → restricted → restored

`risk signal/report → moderation/security case → restriction → notification → appeal → decision → restore OR terminate`

Restriction must be scoped to the actual violation. Global account termination must not be used when a narrower resource or capability restriction is sufficient.

### 4.7 Active → deletion

`delete request → eligibility/dependency check → retention/legal hold check → scheduled deletion → dependent-resource handling → deletion confirmation`

Dependencies include content ownership, comments, messages, subscriptions, payments, creator contracts, organization membership, rights records, analytics/PII, media objects, search indexes, feed caches, notifications, and audit records.

## 5. Cross-client lifecycle rule

Web, H5, Android, iOS, and Mini Program use the same canonical lifecycle semantics and API contracts. Client differences may change presentation, device security integration, push behavior, or deep-link behavior, but may not create incompatible account state machines.

## 6. Admin/support lifecycle rule

Every privileged user lifecycle transition must be represented in the administrative/support model:

- who acted;
- what changed;
- target user;
- previous state;
- new state;
- reason/case reference;
- request/trace/correlation identifier;
- timestamp;
- notification outcome;
- appeal/reversal state where applicable.

## 7. Data and privacy closure

User deletion is a coordinated lifecycle, not a single row delete. The implementation contract must define:

- direct user records;
- owned content;
- authored comments and interactions;
- media ownership;
- subscriptions and entitlements;
- orders/invoices/refunds;
- wallet/ledger/settlement records;
- organization memberships;
- creator contracts;
- moderation/security evidence;
- analytics identifiers;
- search indexes;
- feed/recommendation state;
- caches;
- notification history;
- backups/archives;
- legal holds.

Retention-required financial, legal, security, or audit records must be minimized and de-identified where permitted rather than casually deleted.

## 8. Orphan-state prevention

The following are prohibited:

- entitlement without an authoritative product/order/subscription relationship;
- creator revenue without a source revenue event;
- organization access without membership/scope;
- published content without an owner or explicit platform ownership policy;
- media object without ownership/lifecycle policy;
- moderation action without case/evidence linkage where required;
- notification without a source event or explicit system-generated reason;
- deletion completion while required dependent records remain in an undefined state.

## 9. Pass 04 acceptance criteria

Pass 04 is CLOSED when:

- the complete user lifecycle is represented from anonymous discovery to final deletion;
- orthogonal identity, authorization, subscription, payment, moderation, privacy, and security states are separated;
- creator and organization transitions are explicit;
- monetization and revenue transitions are explicit;
- support/recovery/appeal paths are explicit;
- deletion, retention, legal hold, and dependent-resource handling are explicit;
- Web/H5/Android/iOS/Mini Program share canonical lifecycle semantics;
- no lifecycle step requires an unregistered hidden Feature ID;
- implementation is still blocked until the corresponding Contract-First artifacts are frozen.

## 10. Next closure pass

Pass 05 will close the **full content lifecycle**: creation → revision → moderation → scheduling → publication → distribution → recommendation/search → interaction → paywall/monetization → rights → update/unpublish → archive/restore/delete, including media and derived-resource cleanup.
