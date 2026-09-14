# Luckread Blueprint Pass 06 — API / Client / Admin Mapping v1.0

> Status: **CLOSURE PASS 06 / BLUEPRINT ONLY**
> Scope: map the complete Feature ID inventory to canonical API exposure, client surfaces, and operational/admin surfaces.
> Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` plus closure passes 02–05.

## 1. Objective

A capability is not operationally complete merely because it exists in the feature blueprint. Each capability must have an explicit exposure model: canonical API contract, applicable client entry, administrative/support operation, and lifecycle/compatibility behavior.

Implementation remains blocked until the corresponding Contract-First artifact is frozen.

## 2. Canonical surface model

Every applicable Feature ID must map to these surfaces:

1. **API** — canonical REST/OpenAPI operation or explicitly documented internal/event interface.
2. **Web/H5** — browser user journey or explicit not-applicable reason.
3. **Android** — mobile journey or explicit not-applicable reason.
4. **iOS** — mobile journey or explicit not-applicable reason.
5. **Mini Program** — mini-program journey or explicit not-applicable reason.
6. **Admin** — operational management surface or explicit not-applicable reason.
7. **Support** — support/appeal/escalation surface when applicable.

A surface may be marked `N/A` only with a reason. Silent omission is prohibited.

## 3. Canonical API rules

API-001..013 are mandatory cross-cutting constraints:

- versioned canonical namespace;
- OpenAPI description;
- cursor/pagination semantics where collections are returned;
- stable error envelope;
- trace/request/correlation IDs;
- idempotency for mutation classes that can be retried;
- quotas and rate limits;
- OAuth/API scope boundaries;
- webhook semantics where external delivery is required;
- deprecation and backward compatibility;
- changelog/evidence.

Client-specific code must not create a second incompatible business API.

## 4. Domain-to-surface mapping

| Domain | Feature IDs | Canonical API | Web/H5 | Android | iOS | Mini Program | Admin | Support |
|---|---|---|---|---|---|---|---|---|
| AUTH | AUTH-001..016 | `/v1/auth/*`, `/v1/me/*` | ✓ | ✓ | ✓ | ✓ | account/security ops | recovery/appeal |
| USER | USER-001..010 | `/v1/me/*`, `/v1/users/*` as permitted | ✓ | ✓ | ✓ | ✓ | user management | account support |
| AUTHZ | AUTHZ-001..010 | scoped authorization metadata/internal APIs | ✓ where applicable | ✓ | ✓ | ✓ | ✓ | case-based access |
| CREATOR | CREATOR-001..007 | `/v1/creators/*` | ✓ | ✓ | ✓ | ✓ | creator center | creator support |
| ORG | ORG-001..007 | `/v1/orgs/*` | ✓ | ✓ | ✓ | policy dependent | ✓ | ✓ |
| CONTENT | CONTENT-001..012 | `/v1/content/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ARTICLE | ARTICLE-001..012 | `/v1/articles/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MEDIA | MEDIA-001..015 | `/v1/media/*`, `/v1/live/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| EXTCONTENT | EXTCONTENT-001..006 | typed `/v1/*` resources | ✓ | ✓ | ✓ | policy dependent | ✓ | ✓ |
| FEED | FEED-001..013 | `/v1/feed/*` | ✓ | ✓ | ✓ | ✓ | feed ops | support only where needed |
| REC | REC-001..009 | `/v1/recommendations/*` where public; internal ranking APIs otherwise | ✓ | ✓ | ✓ | ✓ | ✓ | N/A |
| SEARCH | SEARCH-001..010 | `/v1/search/*` | ✓ | ✓ | ✓ | ✓ | search config | N/A |
| SOCIAL | SOCIAL-001..010 | `/v1/social/*` or resource actions | ✓ | ✓ | ✓ | ✓ | moderation/admin | reports |
| COMMUNITY | COMMUNITY-001..008 | `/v1/communities/*` | ✓ | ✓ | ✓ | policy dependent | ✓ | ✓ |
| MSG | MSG-001..008 | `/v1/messages/*` | ✓ | ✓ | ✓ | ✓ | abuse operations | account abuse |
| NOTIFY | NOTIFY-001..008 | `/v1/notifications/*` | ✓ | ✓ | ✓ | ✓ | delivery operations | delivery/support |
| I18N | I18N-001..009 | locale/translation resources | ✓ | ✓ | ✓ | ✓ | translation operations | N/A |
| MON | MON-001..012 | `/v1/plans/*`, `/v1/subscriptions/*`, `/v1/entitlements/*` | ✓ | ✓ | ✓ | ✓ | ✓ | payment/subscription support |
| PAY | PAY-001..013 | `/v1/orders/*`, `/v1/payments/*`, `/v1/payouts/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADS | ADS-001..015 | advertiser/publisher/placement APIs | ✓ | ✓ | ✓ | policy dependent | ✓ | advertiser support |
| RIGHTS | RIGHTS-001..008 | claims/licensing/report APIs | ✓ | ✓ | ✓ | policy dependent | ✓ | appeals |
| SAFETY | SAFETY-001..013 | report/risk/enforcement APIs as appropriate | ✓ | ✓ | ✓ | ✓ | ✓ | appeals |
| GOV | GOV-001..010 | reports/cases/appeals/policy APIs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GROWTH | GROWTH-001..010 | growth/referral/mission resources | ✓ | ✓ | ✓ | ✓ | ✓ | support |
| OPS | OPS-001..009 | campaign/event/promotion APIs | ✓ | ✓ | ✓ | ✓ | ✓ | N/A |
| ANALYTICS | ANALYTICS-001..011 | user-facing analytics + authorized internal analytics | ✓ | ✓ | ✓ | policy dependent | ✓ | N/A |
| SEO | SEO-001..010 | metadata/public resource APIs where applicable | ✓ | ✓ | ✓ | N/A | ✓ | N/A |
| CLIENT | CLIENT-001..010 | client capability/version/config APIs | ✓ | ✓ | ✓ | ✓ | ✓ | N/A |
| API | API-001..013 | `/v1/*`, OpenAPI, webhooks | ✓ | ✓ | ✓ | ✓ | developer/admin | developer support |
| DEV | DEV-001..010 | `/v1/developer/*` | ✓ | ✓ for approved SDK/app flows | ✓ | policy dependent | ✓ | developer support |
| ADMIN | ADMIN-001..010 | privileged admin API namespace | ✓ admin console | N/A end-user surface | N/A | N/A | ✓ | escalation |
| SUPPORT | SUPPORT-001..006 | `/v1/support/*` | ✓ | ✓ | ✓ | policy dependent | ✓ | ✓ |
| CONFIG | CONFIG-001..006 | scoped config/flag APIs | ✓ where exposed | ✓ | ✓ | ✓ | ✓ | N/A |
| EXP | EXP-001..005 | experiment assignment/metrics APIs | ✓ | ✓ | ✓ | ✓ | ✓ | N/A |
| TENANT | TENANT-001..008 | `/v1/tenants/*` | ✓ | ✓ | ✓ | policy dependent | ✓ | tenant support |
| STORAGE | STORAGE-001..008 | signed upload/download/control APIs | ✓ | ✓ | ✓ | ✓ | ✓ | support where needed |
| JOB | JOB-001..008 | internal operational interfaces; no unrestricted public API | N/A | N/A | N/A | N/A | ✓ | N/A |
| DATA | DATA-001..011 | export/import/data-rights APIs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CF | CF-001..009 | infrastructure/internal boundary | N/A | N/A | N/A | N/A | ✓ | N/A |
| PG | PG-001..009 | persistence contract; not a client API | N/A | N/A | N/A | N/A | migration/ops | N/A |
| REL | REL-001..010 | health/status/operational interfaces | limited | limited | limited | limited | ✓ | incident support |
| OBS | OBS-001..010 | operational telemetry interfaces | N/A | N/A | N/A | N/A | ✓ | incident support |
| SEC | SEC-001..010 | security/session/risk operations | ✓ where user-facing | ✓ | ✓ | ✓ | ✓ | security support |
| PRIV | PRIV-001..008 | consent/privacy/data-rights APIs | ✓ | ✓ | ✓ | ✓ | ✓ | privacy support |
| INT | INT-001..010 | provider abstraction/webhooks | selected | selected | selected | selected | ✓ | integration support |
| EXT | EXT-001..007 | ecosystem/commerce APIs | ✓ | ✓ | ✓ | policy dependent | ✓ | partner support |

## 5. Client parity rules

### 5.1 Web/H5

Must expose all user-facing P0 capabilities and provide responsive/authenticated flows. H5 may share Web API and domain semantics.

### 5.2 Android/iOS

Must consume the canonical API. Native capabilities such as push, biometric/passkey integration, deep links, media capture, and platform billing may use adapters but must preserve canonical business semantics.

### 5.3 Mini Program

Must consume the canonical API. Platform-specific login/session exchange may exist at the edge, but resulting identity, authorization, entitlement, content, payment, and audit semantics remain canonical.

### 5.4 Client-specific N/A

A feature may be N/A for a client only if its nature is infrastructure-only, admin-only, developer-only, or otherwise technically irrelevant. The reason must be recorded in the mapping artifact or contract.

## 6. Admin and support closure

Every privileged or operational feature must have an operational owner and surface. At minimum:

- user/account management;
- creator/MCN verification and management;
- content review and publication controls;
- media processing/review;
- subscriptions/orders/refunds/settlement;
- advertiser/campaign/placement operations;
- rights claims;
- reports/moderation/enforcement/appeals;
- notification delivery diagnostics;
- analytics dashboards;
- configuration/feature flags;
- experiments and rollback;
- data export/deletion requests;
- security/risk operations;
- support cases and escalation.

Support agents must not receive unrestricted admin permissions. Support access must be scoped, auditable, time-bounded where appropriate, and case-linked.

## 7. API operation classification

Every Feature ID's API operations must be classified as one or more of:

- public read;
- authenticated read;
- authenticated mutation;
- owner-scoped mutation;
- role/permission-scoped mutation;
- organization-scoped operation;
- admin-only operation;
- support-scoped operation;
- internal service operation;
- webhook/event delivery;
- asynchronous job trigger.

This prevents an implementation from exposing a broad endpoint where a scoped operation is required.

## 8. URL/resource consistency

Canonical resource naming must remain stable across clients. A feature's Web route, mobile deep link, API resource, and admin resource should refer to the same domain concept even when presentation differs.

SEO-bearing content resources must additionally map to:

- canonical URL;
- slug;
- redirect behavior;
- OpenGraph metadata;
- JSON-LD/structured data where applicable;
- sitemap/indexing policy.

## 9. Error and state parity

All clients consume the same canonical error taxonomy and state transitions. Client code must not reinterpret authorization failure as successful mutation or treat asynchronous acceptance as synchronous completion.

Examples:

- `202`/accepted-style async operations remain pending until authoritative completion;
- entitlement denial is not a content-not-found shortcut when the user is entitled to know the resource exists;
- moderation rejection carries a stable policy/case reference where allowed;
- idempotent retries return the same logical result rather than duplicate side effects.

## 10. Webhook/event exposure

External integrations and asynchronous provider callbacks must define:

- event name/version;
- event ID;
- source;
- timestamp;
- signature/authentication;
- replay/retry behavior;
- idempotency key;
- delivery status;
- dead-letter/reconciliation behavior;
- deprecation policy.

## 11. Mapping completeness rule

No Feature ID may remain in a state equivalent to “defined but nowhere usable.” Before Contract-First begins, every Feature ID must have either:

`API + applicable client/admin/support surfaces`

or an explicit classification such as infrastructure-only/internal-only with its operational owner.

## 12. Pass 06 acceptance criteria

Pass 06 is CLOSED when:

- every Feature ID maps to a canonical API or explicit internal interface;
- every user-facing capability maps to applicable Web/H5/Android/iOS/Mini Program surfaces;
- every privileged operational capability maps to Admin and/or Support;
- client-specific N/A cases have reasons;
- API operation scope classes are defined;
- async/webhook behavior has an explicit surface;
- URL/resource/SEO relationships are consistent;
- no client is allowed to invent incompatible business semantics;
- no Feature ID remains operationally orphaned;
- Contract-First remains the next implementation gate.

## 13. Next closure pass

Pass 07 will close **security + authorization + privacy + data lifecycle + reliability** as a single pre-implementation risk matrix, including privileged operations, abuse controls, deletion/retention, backup/restore, disaster recovery, idempotency, retry, and migration safety.
