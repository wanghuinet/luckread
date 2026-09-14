# Luckread Blueprint Pass 03 — Feature ID Deduplication & Cross-Domain Dependency Matrix v1.0

> Status: **CLOSED / BLUEPRINT CLOSURE PASS 03**
>
> Master source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
>
> Purpose: make Feature IDs globally unique, remove hidden/implicit capabilities, and make cross-domain prerequisites explicit before Contract-First implementation.

## 1. Scope

This pass does **not** implement application code and does **not** freeze API contracts. It closes the functional dependency layer between the master Feature ID inventory and the later contract/implementation batches.

The pass is complete when:

1. every Feature ID belongs to exactly one canonical namespace;
2. no Feature ID is duplicated or silently repurposed;
3. no major Feature ID is functionally isolated from its required identity, authorization, lifecycle, API, audit, data, safety, or operational dependencies;
4. dependencies do not create capabilities that are absent from the master blueprint;
5. implementation order can be derived from dependencies rather than ad-hoc coding order;
6. later contract documents must reference these IDs instead of inventing parallel feature names.

## 2. Canonical Feature ID rules

### 2.1 Format

`<DOMAIN>-<NNN>` where `<DOMAIN>` is the uppercase canonical domain prefix and `<NNN>` is a zero-padded numeric identifier.

Examples: `AUTH-001`, `CONTENT-007`, `MON-008`, `PAY-011`.

### 2.2 Uniqueness

- A Feature ID is globally unique within Luckread.
- A Feature ID has one canonical meaning.
- A historical document may contain an old identifier, but it does not create a second active capability.
- A contract, code module, test, issue, migration, or admin operation must reference the active Feature ID.
- A renamed capability keeps its Feature ID unless the semantic capability itself changes; semantic replacement requires an explicit supersession record.
- No implementation may introduce an unregistered Feature ID.

### 2.3 Namespace ownership

The domain prefix is owned by the master blueprint. A team or implementation file must not create a new prefix merely to avoid dependency work.

### 2.4 Historical documents

Archived documents remain reference material only. If an archived document describes a capability that is still required, that capability must map to an existing active Feature ID before implementation. If no active ID exists, the blueprint must be updated first.

## 3. Canonical dependency layers

Luckread dependencies are organized into six layers.

### Layer 0 — Platform invariants

`API`, `SEC`, `PRIV`, `DATA`, `REL`, `OBS`, `PG`, `CF`, `STORAGE`, `JOB`.

These provide platform-wide constraints and adapters. They are not allowed to become hidden business features.

### Layer 1 — Identity and authorization

`AUTH → USER → AUTHZ → TENANT/ORG`.

A user-facing protected capability must have an identifiable actor, authorization scope, ownership rule, and account-state rule where applicable.

### Layer 2 — Core creator/content

`CREATOR/ORG → CONTENT → ARTICLE/MEDIA/EXTCONTENT`.

Publishing capabilities depend on identity, authorization, ownership, lifecycle, moderation, storage where media is involved, and audit.

### Layer 3 — Discovery and interaction

`SOCIAL/COMMUNITY/MSG → FEED/REC/SEARCH → NOTIFY`.

Discovery and interaction depend on canonical content/user identities and safety eligibility. Notifications are downstream signals and must not become an alternative source of truth for state.

### Layer 4 — Trust, monetization and growth

`SAFETY/RIGHTS/GOV → MON/PAY/ADS → GROWTH/OPS`.

Monetization depends on identity, entitlement, content/resource ownership, payment state, financial audit, and policy eligibility. Growth must respect safety, privacy, consent, and eligibility.

### Layer 5 — Operations, clients and ecosystem

`ANALYTICS/SEO/ADMIN/SUPPORT/CLIENT/DEV/CONFIG/EXP/TENANT/INT/EXT`.

These expose, operate, measure, configure, or extend the underlying capabilities and therefore cannot define business state independently of canonical domain records.

## 4. Cross-domain dependency matrix

| Domain | Required upstream | Primary downstream | Dependency rule |
|---|---|---|---|
| AUTH | API, SEC, PRIV, DATA, REL | USER, AUTHZ, NOTIFY, ANALYTICS | identity state is authoritative before protected features |
| USER | AUTH, PRIV, DATA | SOCIAL, FEED, REC, MSG, NOTIFY, ANALYTICS | profile/preferences never own security state |
| AUTHZ | AUTH, USER, ORG/TENANT | all protected domains | server-side authorization is mandatory |
| CREATOR | AUTH, USER, AUTHZ | CONTENT, MEDIA, MON, PAY, ADS, ANALYTICS | creator status/ownership must be authoritative |
| ORG | AUTH, USER, AUTHZ | CREATOR, PAY, ADS, TENANT, ADMIN | membership/scope precedes delegated operations |
| CONTENT | AUTHZ, DATA, SAFETY, RIGHTS | ARTICLE, MEDIA, FEED, SEARCH, SEO, ANALYTICS | lifecycle is canonical |
| ARTICLE | CONTENT, STORAGE where applicable | FEED, SEARCH, MON, SEO, I18N, SOCIAL | article state cannot bypass content lifecycle |
| MEDIA | CONTENT, STORAGE, JOB, SAFETY, RIGHTS | FEED, SEARCH, MON, SEO, ANALYTICS | processing state must precede public delivery |
| EXTCONTENT | CONTENT, AUTHZ, STORAGE where applicable | FEED, SEARCH, MON, SEO | future content types reuse common lifecycle |
| FEED | USER, CONTENT, SOCIAL, REC, SAFETY | CLIENT, ANALYTICS | only eligible canonical content enters feed |
| REC | USER, CONTENT, FEED, SAFETY, EXP | FEED, ANALYTICS | recommendation never overrides policy eligibility |
| SEARCH | CONTENT, USER, SAFETY, I18N | CLIENT, ANALYTICS, SEO | indexed records must obey visibility/deletion state |
| SOCIAL | AUTH, USER, AUTHZ, SAFETY | FEED, NOTIFY, ANALYTICS | relationship/action state is canonical |
| COMMUNITY | AUTHZ, USER, SAFETY, GOV | SOCIAL, MSG, NOTIFY | moderation/rules precede member interaction |
| MSG | AUTH, USER, AUTHZ, SAFETY | NOTIFY, ANALYTICS | delivery state is separate from message truth |
| NOTIFY | AUTH, USER, MSG/SOCIAL/MON/SAFETY | CLIENT, ANALYTICS | notifications reflect events; they do not define source state |
| I18N | CONTENT, USER, REGION/CONFIG | CLIENT, SEARCH, SEO | translation is a versioned representation, not a replacement for source content |
| MON | AUTHZ, CONTENT, USER, PAY | CLIENT, NOTIFY, ANALYTICS | entitlement must be authoritative and revocable |
| PAY | AUTH, AUTHZ, MON, ORG/CREATOR | MON, ADMIN, ANALYTICS | ledger/order/settlement states must be auditable |
| ADS | AUTHZ, ORG, CONTENT, SAFETY, PAY | CLIENT, ANALYTICS | inventory/creative/targeting must pass policy and financial controls |
| RIGHTS | CONTENT, MEDIA, AUTHZ, SAFETY, GOV | MON, ADMIN, ANALYTICS | rights claims must not silently mutate ownership |
| SAFETY | AUTH, USER, CONTENT, MEDIA, SOCIAL, PAY | GOV, ADMIN, FEED, SEARCH, MON | enforcement state must be authoritative and auditable |
| GOV | SAFETY, USER, CONTENT, RIGHTS | ADMIN, SUPPORT, ANALYTICS | case/appeal/policy lifecycle is canonical |
| GROWTH | USER, CONTENT, CREATOR, ANALYTICS, SAFETY | MON, OPS, NOTIFY | incentives must respect eligibility and anti-abuse rules |
| OPS | CONTENT, CREATOR, ADS, MON, CONFIG | CLIENT, NOTIFY, ANALYTICS | campaigns cannot bypass lifecycle or policy |
| ANALYTICS | events from all domains + PRIV | ADMIN, CREATOR, ORG, OPS | analytics is derived data, not business truth |
| SEO | CONTENT, ARTICLE, MEDIA, USER, CONFIG | CLIENT, SEARCH | indexability follows visibility/canonical state |
| CLIENT | API, AUTH, CONFIG | all user-facing domains | clients consume canonical contracts |
| API | all exposed domains + SEC/REL | CLIENT, DEV, INT/EXT | API contract cannot invent hidden domain behavior |
| DEV | AUTH, AUTHZ, API, SEC | INT, EXT, CLIENT | third-party access is scoped and auditable |
| ADMIN | AUTHZ, SAFETY, GOV, DATA | all operated domains | privileged actions require explicit permission and audit |
| SUPPORT | AUTH, USER, GOV, PAY, ADMIN | AUTH/CONTENT/PAY/SAFETY | support operations cannot bypass authorization |
| CONFIG | AUTHZ, TENANT, EXP | all configurable domains | config changes are audited and versioned |
| EXP | CONFIG, ANALYTICS, AUTHZ | FEED, REC, CLIENT, GROWTH | experiments require explicit audience/rollback/metrics |
| TENANT | AUTH, USER, AUTHZ, DATA | ORG, DEV, ADMIN, PAY | tenant isolation is a security invariant |
| STORAGE | DATA, SEC, REL | MEDIA, ARTICLE, CONTENT | object storage is abstracted from domain logic |
| JOB | API, REL, OBS, DATA | MEDIA, CONTENT, ANALYTICS, PAY | async execution requires retry/idempotency/DLQ rules |
| DATA | all persistent domains + PRIV | PG, CF, ADMIN | schema/migration/retention rules are explicit |
| CF | API/REL/OBS + adapters | runtime implementation | infrastructure adapter only |
| PG | DATA + domain-neutral schema | persistence implementation | PostgreSQL portability must not alter business semantics |
| REL | API, JOB, DATA, CF/PG | all domains | failure behavior is explicit and testable |
| OBS | API, JOB, SEC, all domains | ADMIN, SUPPORT, OPS | operational evidence must correlate to canonical operations |
| SEC | AUTH, API, DATA, STORAGE, JOB | all domains | security controls are cross-cutting invariants |
| PRIV | AUTH, USER, DATA, ANALYTICS | all data-bearing domains | collection/use/retention/deletion must be explicit |
| INT | API, AUTHZ, SEC | PAY, ADS, DEV, EXT | external systems are adapters, not sources of internal authorization |
| EXT | API, AUTHZ, CONTENT/MON/PAY as applicable | future ecosystem | extension capabilities must first be registered |

## 5. Critical dependency chains

### 5.1 Registration to protected action

`AUTH-001/002/003 → USER-001/002/003 → AUTHZ-001/002/005 → target domain capability`

### 5.2 Creator publishing

`AUTH → USER → AUTHZ → CREATOR-001/002 → CONTENT-001..010 → ARTICLE/MEDIA → SAFETY/RIGHTS → publish → FEED/SEARCH/SEO → ANALYTICS`

### 5.3 Paid article

`AUTH → AUTHZ → CONTENT/ARTICLE → MON-003 → MON-008 → PAY-002/006 → AUTHZ-004/006 → content access → NOTIFY → ANALYTICS`

### 5.4 Creator revenue

`CREATOR/ORG → PAY-002/006/007 → PAY-009 where applicable → PAY-011 → PAY-010 → PAY-012 → ANALYTICS`

### 5.5 Advertising

`ORG/advertiser identity → ADS-001..006 → ADS-010 → ADS-004 inventory → delivery → ADS-007/008/009 → PAY/ANALYTICS → settlement`

### 5.6 Moderation and appeal

`report → GOV-001/002 → GOV-003 → SAFETY-001..012 → GOV-004 → enforcement → GOV-005 appeal → policy/audit → analytics`

### 5.7 Content deletion

`CONTENT-008 → AUTHZ/RIGHTS/SAFETY checks → DATA-009 → STORAGE-008 → SEARCH/FEED/SEO invalidation → NOTIFY where required → audit`

## 6. Orphan prevention rules

The following are explicitly forbidden:

- a public feature without API ownership;
- a protected feature without AUTHZ mapping;
- a content feature without lifecycle state;
- a media feature without storage/processing semantics;
- a paid feature without entitlement and payment linkage;
- a revenue feature without ledger/settlement/audit linkage;
- a moderation action without case/enforcement/audit linkage;
- a notification without an authoritative source event;
- a search/feed result that ignores visibility, deletion, moderation, or rights state;
- a client-only feature with no canonical contract unless documented as client-specific;
- an analytics metric that becomes the authoritative business state;
- an external integration that bypasses internal authorization;
- a migration-sensitive data model that depends irreversibly on a Cloudflare-only primitive.

## 7. Dependency order for implementation batches

The master 24-batch delivery order is retained, but each batch must satisfy its upstream prerequisites:

1. Foundation/identity → Layer 0 + Layer 1
2. Creator/org → identity + authorization
3. Content authoring → creator/org + lifecycle + safety baseline
4. Media → content + storage + jobs + safety
5. Social graph → identity + authorization + safety
6. Feed/discovery → content + social + safety + recommendation baseline
7. Notification/messaging → identity + interaction + async
8. i18n/translation → content + user + versioning
9. Paid content → authorization + content + entitlement + payment
10. Payments/revenue → identity + entitlement + ledger
11. Advertising → organization + safety + payment + analytics
12. Rights/safety → content/media + governance
13. Growth/operations → identity/content/analytics/safety
14. Analytics → canonical event sources + privacy
15. API/open platform → stabilized domain contracts + security
16. Clients/SEO → canonical API + content state
17. Admin/support → all operated domain permissions
18. Config/experiments → config + authorization + analytics
19. Async/reliability → cross-cutting job/failure semantics
20. Security/privacy → all persistent/user-facing capabilities
21. Data portability → data/privacy/migration rules
22. Cloudflare/PostgreSQL portability → adapter and migration boundaries
23. Enterprise/ecosystem → tenant/org/developer/security foundations
24. Future content/commerce → extension contracts and reused lifecycle/monetization primitives

A later batch may be developed in parallel only when all of its declared upstream contract dependencies are already frozen.

## 8. No-hidden-feature rule

A dependency is not permission to create a new capability silently.

Example: `MON-008` depends on entitlement, payment, content state, authorization, notification, audit, and analytics. These dependencies may be implemented as supporting parts of existing Feature IDs; they do not justify creating an unregistered “paywall manager” feature.

If implementation reveals a genuinely new user-visible or operator-visible capability, development stops for that capability, a new Feature ID is added to the master blueprint, and the dependency matrix is updated before implementation continues.

## 9. Pass 03 acceptance gate

Pass 03 is considered closed when all of the following are true:

- [x] Master Feature ID inventory is the canonical namespace.
- [x] Feature ID uniqueness and ownership rules are explicit.
- [x] Cross-domain upstream/downstream dependencies are explicit.
- [x] Critical user journeys have dependency chains.
- [x] Orphan/isolated capability rules are explicit.
- [x] Implementation batches have prerequisite ordering.
- [x] Hidden-feature creation is prohibited.
- [x] This pass does not introduce application implementation code.
- [x] Contract-First remains the next implementation discipline after blueprint closure.

## 10. Relationship to the 8-pass closure

| Pass | State |
|---|---|
| 01 — Master Feature Blueprint | CLOSED |
| 02 — Feature Completeness Closure | CLOSED |
| **03 — Feature ID + Dependency Matrix** | **CLOSED** |
| 04 — User Full Lifecycle Matrix | NEXT |
| 05 — Content Full Lifecycle Matrix | PENDING |
| 06 — Platform/API/Client/Admin Mapping | PENDING |
| 07 — Security/Permission/Privacy/Data/Reliability Matrix | PENDING |
| 08 — Final Blueprint Acceptance / Freeze | PENDING |

## 11. Final rule

After Pass 08, the blueprint phase is frozen. No repeated open-ended functional audit is allowed. Any genuinely new capability after freeze must enter through a controlled blueprint change record before Contract-First work.
