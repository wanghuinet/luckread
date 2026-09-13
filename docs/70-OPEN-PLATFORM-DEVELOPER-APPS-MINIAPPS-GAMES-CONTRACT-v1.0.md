# LuckRead Open Platform / Developer / Apps / Mini Apps / Games Contract v1.0

## 1. Purpose

This contract defines the external ecosystem boundary for LuckRead: developers, third-party applications, mini apps, plugins/extensions, SDKs, webhooks, API access, app review, release lifecycle, quotas, analytics, and security.

The goal is to expose LuckRead capabilities without exposing internal storage or Payload implementation details.

## 2. Architectural Position

```text
Developer
  ↓
Developer Account
  ↓
App / Client
  ↓
Permission / Scope
  ↓
API / SDK / Webhook
  ↓
LuckRead Domain APIs
  ↓
Domain Authority
```

Third-party applications MUST NOT directly access D1, R2, Payload internals, internal queues, Durable Objects, cache keys, or private service interfaces.

## 3. Cloudflare-First Boundary

The platform is deployed on Cloudflare as the default runtime boundary:

- Workers: API gateway, authentication boundary, public API adapters, webhook delivery and lightweight application logic.
- D1: authoritative structured application/domain state where applicable.
- R2: large objects and media.
- Queues: asynchronous delivery, fanout, aggregation and integration events.
- KV/Cache: derived or hot state only.
- Durable Objects: strong coordination and stateful coordination only where required.
- Cron/Workflows: scheduled and durable platform operations where appropriate.
- Payload: current CMS/authentication/application foundation; internal implementation remains encapsulated.

External applications consume stable public contracts rather than Cloudflare bindings.

## 4. Developer Identity

The platform MUST support:

1. Developer account.
2. Organization/developer team.
3. Developer members and roles.
4. App ownership and transfer rules.
5. Security credentials and credential rotation.
6. Developer agreement and policy acceptance.
7. Suspension/revocation lifecycle.

Developer identity MUST remain distinct from end-user identity, while authorized application access may operate on behalf of an end user.

## 5. App Model

An App is the registered integration unit.

Minimum lifecycle:

`Draft → Submitted → Reviewed → Approved → Active → Suspended/Revoked → Archived`

An App MUST have:

- immutable app identifier;
- display name and description;
- owner/developer organization;
- environment information;
- redirect/webhook endpoints where applicable;
- requested scopes;
- status;
- version/release metadata;
- security configuration;
- audit history.

Development, staging and production credentials MUST be separable.

## 6. Permission and Scope

Permissions MUST be explicit and least-privilege.

Example scope families:

- user.read
- user.write
- content.read
- content.write
- media.read
- media.upload
- social.read
- social.write
- creator.read
- creator.write
- analytics.read
- commerce.read
- webhook.manage

Sensitive scopes MUST require stronger review and, where appropriate, end-user consent.

The platform MUST distinguish:

`App authorization ≠ User authorization ≠ Domain ownership authority`.

## 7. OAuth / Token Boundary

The public platform SHOULD use standard OAuth 2.x/OIDC-compatible flows where delegated authorization is required.

Rules:

- Access tokens are short-lived where practical.
- Refresh credentials are protected and revocable.
- Client secrets are never exposed to browsers when a confidential client is required.
- Scope is encoded and enforced server-side.
- Token introspection/revocation is an internal security operation.
- Credentials MUST NOT be persisted in logs or analytics.

## 8. Open API

Public APIs MUST be versioned and contract-driven.

Canonical form:

`/v1/...`

Every public endpoint MUST define:

- authentication requirement;
- authorization scopes;
- request schema;
- response schema;
- error model;
- idempotency behavior where applicable;
- pagination;
- rate/quota behavior;
- audit/security requirements;
- deprecation policy.

Internal APIs MUST NOT automatically become public APIs.

## 9. SDK Boundary

SDKs are generated or maintained against the public API contract.

SDKs MAY provide:

- authentication helpers;
- typed API clients;
- pagination;
- retries within documented limits;
- webhook signature verification;
- upload helpers;
- error normalization.

SDKs MUST NOT expose internal D1/R2/Payload bindings.

## 10. Webhooks and Events

Webhook delivery is asynchronous and MUST be treated as at-least-once delivery unless a stronger guarantee is explicitly contracted.

Every webhook SHOULD contain:

- event id;
- event type;
- schema version;
- occurred-at timestamp;
- delivery attempt metadata;
- resource reference;
- minimal payload required by the contract.

Consumers MUST implement idempotency.

Delivery pipeline:

`Domain Event → Queue → Webhook Dispatcher → Signed Request → Consumer`

Webhook signing secrets MUST be isolated from ordinary application credentials.

## 11. Rate Limits and Quotas

Rate limiting MUST protect platform stability and prevent abuse.

Quota dimensions MAY include:

- requests;
- writes;
- media uploads;
- webhook deliveries;
- API bandwidth;
- analytics/event ingestion;
- application-specific resource limits.

The quota system MUST distinguish platform protection from commercial billing.

429 responses SHOULD include machine-readable retry information where appropriate.

## 12. Developer Console

Developer Console SHOULD provide:

- app registration;
- credentials;
- scope management;
- OAuth configuration;
- webhook configuration;
- API documentation;
- API usage;
- quota status;
- logs/audit information appropriate for developers;
- environment management;
- release management;
- review status;
- security alerts.

Sensitive credentials MUST be displayed only when policy permits and SHOULD support immediate rotation.

## 13. Mini App Boundary

Mini Apps are sandboxed application experiences running on top of LuckRead capabilities.

Mini Apps MUST use declared capabilities and public APIs.

They MUST NOT:

- execute arbitrary privileged platform code;
- access raw D1/R2;
- bypass authorization;
- access another app's secrets;
- bypass moderation/risk controls;
- directly mutate financial ledger facts.

Mini App lifecycle:

`Draft → Test → Review → Approved → Published → Updated → Suspended/Removed`

## 14. Plugin / Extension Boundary

Extensions MAY integrate with documented extension points.

Extension points MUST declare:

- lifecycle;
- input/output contract;
- permission scope;
- timeout;
- failure behavior;
- resource limits;
- security requirements;
- version compatibility.

An extension failure MUST NOT corrupt authoritative domain state.

## 15. Game Integration

Games are treated as applications using the Open Platform, not as a special privileged backend.

Game integrations MAY use:

- user identity/delegated login;
- profile information under scope;
- content/media APIs;
- social graph APIs;
- notifications;
- payments/entitlements through approved commerce contracts;
- game-specific service endpoints owned by the game developer.

Game state MUST remain owned by the game domain unless explicitly registered as a LuckRead domain resource.

## 16. Third-Party Data Access

Third-party applications MUST receive only the minimum data required by their declared purpose.

Responses SHOULD use stable public DTOs rather than internal persistence models.

Private fields, security metadata, moderation internals, risk signals, credentials and financial secrets MUST NOT leak through generic serializers.

## 17. App Review and Trust

Apps MUST pass automated and, where required, human review before production publication.

Review dimensions include:

- identity;
- requested scopes;
- privacy/data usage;
- security;
- abuse potential;
- content policy;
- webhook behavior;
- redirect URI validation;
- secret handling;
- user experience;
- commercial/payment behavior where applicable.

Risk and Trust systems remain authoritative for platform abuse decisions.

## 18. Versioning and Release

App releases MUST be independently versioned.

The platform MUST support:

- draft versions;
- compatibility checks;
- release approval;
- rollback/deactivation;
- deprecated API versions;
- migration notices.

Breaking public API changes require a new major contract version or explicit compatibility strategy.

## 19. Sandbox

Developer testing SHOULD use isolated sandbox environments and test credentials.

Sandbox MUST prevent accidental access to production secrets and production financial authority.

Where practical, sandbox APIs SHOULD expose deterministic test fixtures and simulated webhook delivery.

## 20. Billing and Commercial Boundary

Developer billing MAY account for contracted API usage, storage, media processing, or other platform resources.

Usage evidence MUST flow through the platform measurement pipeline before becoming a billing candidate.

`Usage Evidence → Validation → Billing Candidate → Authoritative Commerce/Ledger Flow`

Open Platform MUST NOT become a second wallet or ledger authority.

## 21. API Analytics

Developer-facing analytics MAY expose:

- request volume;
- success/error rate;
- latency;
- quota consumption;
- webhook delivery status;
- resource usage;
- approved business metrics.

Analytics are derived views and MUST NOT replace domain authority.

## 22. Security and Risk

All public integration traffic MUST pass through platform security controls.

Required controls include:

- authentication;
- authorization;
- scope enforcement;
- rate limiting;
- abuse detection;
- request validation;
- webhook signature verification;
- credential rotation/revocation;
- audit logging;
- anomaly detection;
- data minimization.

Risk signals MUST NOT be exposed as raw internal scoring data unless explicitly contracted.

## 23. Open Platform Event Contract

Important platform events include:

- app.created
- app.updated
- app.submitted
- app.approved
- app.suspended
- app.revoked
- app.version.published
- developer.credential.rotated
- webhook.delivery.failed
- quota.threshold.reached
- miniapp.published
- miniapp.suspended

Events are integration signals, not automatic authority transfers.

## 24. Ownership Boundary

| Capability | Authority |
|---|---|
| Developer identity | Identity / Developer domain |
| End-user identity | User Identity domain |
| App registration | Open Platform domain |
| Public API contract | Open Platform API layer + owning domain |
| Content | Content domain |
| Media | Media domain |
| Social graph | Social Graph domain |
| Creator | Creator domain |
| Risk | Risk / Trust domain |
| Moderation | Moderation domain |
| Commerce | Commerce domain |
| Financial facts | Wallet / Ledger domain |
| Storage | D1 / R2 infrastructure boundary |
| Payload internals | Payload implementation boundary |

No Open Platform component may silently become the authority for another domain.

## 25. Failure and Reliability Rules

Public API failures MUST be isolated from authoritative state.

Rules:

- retries MUST respect idempotency;
- webhook retries MUST be bounded and observable;
- asynchronous work SHOULD use Queue/Workflow boundaries;
- slow or large processing MUST NOT block ordinary API requests;
- partial third-party failure MUST degrade only the affected integration where possible;
- circuit breaking and backoff SHOULD protect external dependencies.

## 26. Observability and Audit

Every externally meaningful operation SHOULD carry:

- requestId;
- correlationId where cross-service work exists;
- traceId where tracing is enabled;
- appId;
- developerId where applicable;
- userId only where authorized and necessary;
- eventId for asynchronous operations.

Secrets, tokens, private message content and unnecessary personal data MUST NOT enter ordinary telemetry.

## 27. API Contract Admission Gate

An Open Platform capability is READY only when all are true:

- domain owner identified;
- public/private boundary defined;
- DTO/schema defined;
- authentication defined;
- scopes defined;
- rate/quota behavior defined;
- idempotency defined where needed;
- error contract defined;
- audit/security requirements defined;
- webhook/event behavior defined where applicable;
- versioning/deprecation defined;
- sandbox strategy defined where applicable;
- abuse/risk path defined;
- acceptance tests defined.

## 28. Non-Goals

This contract does NOT introduce:

- direct third-party D1 access;
- direct third-party R2 bucket access without controlled signed/API boundaries;
- Payload source modification;
- a second identity authority;
- a second commerce authority;
- a second financial ledger;
- a mandatory external API gateway product;
- a mandatory Kubernetes/service-mesh platform;
- unrestricted plugin execution;
- unrestricted mini-app execution.

## 29. Integration Strategy

Cloudflare-native capabilities remain the default implementation path.

External infrastructure may be introduced only behind an explicit Adapter/API/Event boundary when it provides a mature capability that is materially stronger than the Cloudflare-native baseline.

The Open Platform exposes contracts, not infrastructure topology.

## 30. Definition of Done

Document status becomes `CONTRACT-READY` only after:

1. L1-L4 capability traceability exists.
2. API and DTO boundaries are frozen.
3. Permission and security model is explicit.
4. App/mini-app lifecycle is explicit.
5. Webhook/event semantics are explicit.
6. Quota/rate-limit behavior is explicit.
7. Domain ownership is explicit.
8. Cloudflare-first implementation boundary is explicit.
9. Failure/reliability behavior is explicit.
10. Test and acceptance criteria are defined.
11. No internal implementation contract leaks into the public API.

Implementation MUST NOT begin before this admission gate passes.
