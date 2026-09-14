# Luckread Blueprint Pass 07 — Security / Permission / Privacy / Data / Reliability Matrix v1.0

> Status: **CLOSURE PASS 07 / BLUEPRINT ONLY**
> Scope: close security, authorization, privacy, data lifecycle, reliability, abuse resistance, and migration safety before Blueprint Freeze.
> Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` plus Closure Passes 02–06.

## 1. Objective

A capability is not complete merely because its business flow works. Every data-bearing or privileged capability must define who may act, what data may be accessed, how abuse is controlled, how state survives failure, how data is retained/deleted/exported, and how the capability can migrate from the current Cloudflare deployment toward standard PostgreSQL/GCP infrastructure.

This pass is the final risk/compliance/reliability closure before Blueprint Freeze.

## 2. Security control dimensions

Every applicable Feature ID must be evaluated against:

- authentication;
- authorization;
- resource ownership;
- organization/tenant scope;
- API scope;
- field-level write protection;
- session/token security;
- input validation;
- output/data minimization;
- upload security;
- secret handling;
- encryption in transit/at rest where applicable;
- rate limiting;
- abuse/fraud detection;
- auditability;
- incident response;
- retention/deletion requirements.

No client-provided role, entitlement, ownership, moderation state, payment state, or security state is authoritative.

## 3. Authorization matrix

| Domain | Primary authorization | Additional scope | Privileged operations | Audit required |
|---|---|---|---|---|
| AUTH | authenticated/self | device/session | freeze, ban, recovery override | ✓ |
| USER | self/owner | privacy scope | support recovery/data action | ✓ |
| AUTHZ | permission/role | org/tenant/resource | role/permission changes | ✓ |
| CREATOR | owner/creator role | org/workspace | verification/status/revenue operations | ✓ |
| ORG | org role | tenant/workspace | membership, contract, split, transfer | ✓ |
| CONTENT | owner/editor | org/workspace | review/publish/unpublish/transfer | ✓ |
| ARTICLE | owner/editor | publication scope | paywall/editorial override | ✓ |
| MEDIA | owner/uploader | resource scope | moderation/right/license operations | ✓ |
| FEED/REC | authenticated/public policy | region/audience | ranking/config overrides | ✓ |
| SOCIAL | actor + relationship policy | block/mute/privacy | moderation/admin intervention | ✓ |
| COMMUNITY | member/moderator | community scope | rules/moderation/slow mode | ✓ |
| MSG | participant | conversation scope | abuse investigation | ✓ |
| NOTIFY | self/system | channel preference | campaign/security sends | ✓ |
| I18N | content owner/editor | locale | translation approval/override | ✓ |
| MON/PAY | authenticated owner | account/creator/org | refund/settlement/payout | ✓ |
| ADS | advertiser/publisher role | tenant/campaign | billing/approval/placement override | ✓ |
| RIGHTS | rights owner/claimant | asset/content | claim/takedown/counter-notice | ✓ |
| SAFETY/GOV | authorized moderator/admin | case/policy scope | enforcement/appeal resolution | ✓ |
| ANALYTICS | owner/role | aggregation/privacy scope | raw-data access/export | ✓ |
| ADMIN | admin permission | least-privilege scope | privileged platform operations | ✓ |
| SUPPORT | support role | case scope | temporary delegated access | ✓ |
| DATA/PRIV | subject/authorized role | jurisdiction/retention | export/delete/legal hold | ✓ |
| CONFIG/EXP | operator role | env/tenant/client | flags/rollout/rollback | ✓ |
| TENANT | tenant owner/admin | tenant scope | isolation/quota/billing changes | ✓ |
| STORAGE | owner/service role | object scope | delete/restore/lifecycle override | ✓ |
| JOB/CF/PG/REL/OBS | service/operator | environment | infrastructure and recovery operations | ✓ |
| INT/EXT | app/provider scope | integration tenant | credentials/webhooks/provider config | ✓ |

## 4. Security state invariants

The following are mandatory invariants across implementation:

1. Authorization is evaluated server-side.
2. Authentication success does not imply resource authorization.
3. Ownership is checked against the authoritative resource owner.
4. Organization and tenant scope cannot be widened by client parameters.
5. Protected fields cannot be client-written through generic update paths.
6. Security-sensitive state changes require explicit privileged operations.
7. Passwords, tokens, API secrets, payment credentials, webhook secrets, and private keys never enter normal logs.
8. Sensitive tokens are single-use and time-bounded where their semantics require it.
9. Session revocation is authoritative.
10. Admin/support actions are auditable and attributable.
11. Bulk operations are permission-checked per target scope.
12. Export/delete operations require subject authorization and abuse controls.

## 5. Abuse and anti-automation matrix

Applicable domains must provide controls for:

- registration abuse;
- credential stuffing/brute force;
- verification-code abuse;
- session/token abuse;
- scraping and enumeration;
- spam comments/messages;
- fake likes/follows/views;
- referral/reward abuse;
- subscription/payment fraud;
- coupon/mission abuse;
- advertising click/impression fraud;
- upload/media abuse;
- malicious links/content;
- bot-generated account farms;
- moderation/report brigading.

Controls may include rate limits, quotas, risk scoring, device/IP signals, challenge mechanisms, reputation, frequency caps, anomaly detection, queue isolation, and manual review. A single control must not be treated as the complete anti-abuse system.

## 6. Privacy matrix

Every personal-data feature must classify:

- data category;
- purpose;
- lawful/declared processing basis where applicable;
- visibility;
- collection point;
- retention period/class;
- deletion behavior;
- export behavior;
- access-control scope;
- regional restrictions;
- audit requirements.

Privacy controls include:

- profile visibility;
- contact/identity privacy;
- activity/history privacy;
- analytics consent where applicable;
- cookie/measurement consent where applicable;
- personalized recommendation controls;
- advertising personalization controls;
- data export/access;
- account deletion;
- content/user deletion dependencies;
- age/child safety;
- regional policy enforcement.

## 7. Data lifecycle matrix

Every persistent domain object must have a documented lifecycle:

`create → active → update → archive/disable → retention → delete/anonymize → physical cleanup`

Where applicable, it must additionally support:

`restore`, `legal hold`, `export`, `migration`, `reconciliation`.

Deletion is coordinated rather than a single-row operation. Dependent indexes, search documents, feed candidates, recommendations, cache entries, media objects, notifications, analytics records, rights claims, payment records, and audit records must each follow their defined retention/deletion policy.

Financial, security, legal, and audit records may require retention after user-facing deletion; such retention must be explicitly scoped and must not be mistaken for indefinite personal-data retention.

## 8. Backup / restore / disaster recovery

The platform must define:

- backup scope;
- backup frequency;
- encryption/access controls;
- retention;
- restore procedure;
- restore verification;
- point-in-time recovery where supported;
- recovery point objective (RPO);
- recovery time objective (RTO);
- dependency ordering;
- incident ownership;
- rollback criteria.

A backup that has never been restore-tested is not considered verified.

## 9. Reliability matrix

Applicable async and distributed operations require:

- timeout;
- retry policy;
- exponential backoff where appropriate;
- idempotency;
- deduplication;
- dead-letter handling;
- reconciliation;
- circuit breaking where useful;
- graceful degradation;
- health/readiness/liveness signals;
- rollback or compensating operation.

Critical examples:

| Operation | Required reliability controls |
|---|---|
| registration/verification | idempotency + rate limit + expiry |
| payment | idempotency + provider reconciliation + webhook verification |
| entitlement grant | transaction/order linkage + replay safety |
| refund | idempotency + entitlement reversal policy |
| creator payout | ledger linkage + settlement reconciliation |
| media processing | queue + retry + DLQ + status reconciliation |
| notifications | queue + retry + deduplication + provider status |
| feed/index refresh | async retry + invalidation + rebuild path |
| moderation | durable case state + retry + audit |
| data export | async job + status + signed delivery + expiry |
| account deletion | dependency orchestration + retry + final verification |
| webhook | signature + event ID + idempotency + retry/DLQ |
| scheduled publishing | idempotency + authoritative state check |
| live/replay processing | state machine + recovery + reconciliation |

## 10. Concurrency and consistency

Every mutation with meaningful concurrent access must define its conflict behavior:

- optimistic version check;
- authoritative last-write policy where acceptable;
- explicit conflict response;
- idempotency key where retry duplication is possible;
- state-transition preconditions;
- no client-side assumption that a previous read remains authoritative.

Financial, entitlement, moderation, rights, account-security, and ownership transitions require stronger invariants than ordinary profile edits.

## 11. Migration safety

Cloudflare-specific infrastructure is implementation detail. Domain contracts must remain portable.

Migration requirements:

- UUID/portable identifier strategy;
- UTC timestamps;
- standard relational constraints;
- portable SQL semantics where feasible;
- JSON data with documented schema rather than provider-specific opaque structures;
- migration scripts/versioning;
- import/export format;
- object-storage abstraction;
- search/index rebuild strategy;
- queue/job replay strategy;
- audit/financial record preservation;
- dual-read/dual-write only where explicitly justified;
- reconciliation report;
- cutover validation;
- rollback plan.

The target is a controlled Cloudflare → standard PostgreSQL/GCP migration, not a future rewrite of business semantics.

## 12. Security / privacy / reliability by domain

| Domain group | Security | Privacy | Data lifecycle | Reliability | Migration |
|---|---|---|---|---|---|
| Identity/Auth | mandatory | high | mandatory | critical | mandatory |
| User/AuthZ | mandatory | high | mandatory | critical | mandatory |
| Creator/Org | mandatory | high | mandatory | high | mandatory |
| Content/Media | mandatory | medium/high | mandatory | critical | mandatory |
| Feed/Rec/Search | mandatory | high | mandatory | critical | mandatory |
| Social/Community/MSG | mandatory | high | mandatory | high | mandatory |
| I18N | mandatory | medium | mandatory | medium | mandatory |
| Monetization/Payment | critical | critical | critical | critical | critical |
| Ads | critical | critical | mandatory | high | mandatory |
| Rights/Safety/Gov | critical | high | critical | critical | mandatory |
| Growth/Ops | mandatory | medium/high | mandatory | high | mandatory |
| Analytics | critical | critical | critical | high | mandatory |
| API/DEV | critical | high | mandatory | critical | mandatory |
| Admin/Support | critical | critical | mandatory | high | mandatory |
| Config/Exp/Tenant | critical | high | mandatory | critical | mandatory |
| Storage/Jobs/Data | critical | high | critical | critical | critical |
| CF/PG/REL/OBS | critical | high | critical | critical | critical |
| INT/EXT | critical | high | mandatory | critical | mandatory |

## 13. Privileged-operation security gate

The following operations must never be treated as ordinary CRUD:

- role/permission changes;
- account freeze/ban/unban;
- creator/org verification;
- ownership transfer;
- content publication override;
- moderation enforcement;
- appeal resolution;
- paywall/entitlement override;
- refund/chargeback/settlement adjustment;
- creator payout changes;
- advertiser billing/placement overrides;
- rights takedown/counter-notice resolution;
- raw analytics export;
- user data export/deletion override;
- tenant isolation/quota changes;
- feature flag production rollout/rollback;
- security/risk override;
- provider credentials/webhook configuration.

Each must have explicit permission, scope, reason/context where appropriate, actor identity, timestamp, target, before/after state or equivalent event, and immutable audit evidence.

## 14. Legal hold and deletion precedence

Where legal hold or required financial/security retention conflicts with user-facing deletion, the system must:

1. identify the retained records;
2. restrict them to the minimum required scope;
3. remove ordinary user-facing access;
4. record retention reason and expiry/review condition;
5. prevent accidental physical deletion while held;
6. release and purge when the hold ends.

## 15. Observability requirements

Security and reliability events must be correlated through stable request/trace/correlation identifiers. Operational telemetry must distinguish:

- authentication failures;
- authorization denials;
- abuse/risk events;
- payment failures;
- queue failures;
- webhook failures;
- moderation failures;
- data export/deletion failures;
- migration/reconciliation mismatches;
- infrastructure degradation.

Logs must be useful for incident response without becoming a secondary store of secrets or unnecessary personal data.

## 16. Pass 07 acceptance criteria

Pass 07 is CLOSED when:

- every privileged Feature ID has explicit authorization and audit requirements;
- every personal-data capability has privacy/lifecycle treatment;
- every deletion path accounts for dependent data;
- financial/security/legal retention is explicit;
- async critical operations have retry/idempotency/failure handling;
- backup/restore and DR are defined;
- abuse controls cover the major attack/abuse classes;
- migration constraints are embedded in the domain model;
- no Cloudflare-specific implementation detail becomes a permanent domain dependency;
- observability and incident evidence are defined;
- no critical capability is security/reliability-orphaned.

## 17. Final closure gate

After this pass, only Pass 08 remains. Pass 08 will create the **Blueprint Acceptance / Freeze** record, reconcile all eight closure passes, freeze the Feature ID inventory, and explicitly declare the project ready for Contract-First implementation.

No additional audit pass is planned after Pass 08 unless a genuinely new product capability is introduced. New capability follows the rule:

`Feature ID → blueprint amendment → contract → implementation → verification`.
