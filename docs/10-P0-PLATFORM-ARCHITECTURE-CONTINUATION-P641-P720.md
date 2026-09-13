# LuckRead Platform Architecture Continuation — P641–P720

Status: DOCUMENTED / ARCHITECTURE-ONLY

This document records the architecture decisions completed in the current planning session. It is a design source-of-truth artifact; it does not claim implementation, CI Green, E2E Green, Security Green, or Release Green unless independently evidenced by GitHub Actions and repository artifacts.

## P641–P660 — Workflow / Moderation / Review / Approval Platform

### P641 Unified Action Decision
A state-changing action is allowed only when Permission + Scope + State + Policy + Approval requirements are satisfied.

### P642 State Machine vs Workflow
State Machine defines the current authoritative state and legal transitions. Workflow defines the human/system process used to reach a transition. They are separate contracts.

### P643 Machine-readable Workflow Contract
Workflow contracts live under `contracts/workflow/` and define workflow identity, version, states, transitions, tasks, policies, timeout, escalation, and audit requirements.

### P644 Initial Workflow Registry
Initial workflows: CONTENT_REVIEW, MEDIA_REVIEW, COMMENT_MODERATION, ACCOUNT_REVIEW, ORGANIZATION_REVIEW, IP_REVIEW, PAYMENT_REVIEW, REFUND_REVIEW, PAYOUT_REVIEW, APPEAL_REVIEW.

### P645 Transition Contract
A transition is evaluated as `current_state + action + actor + policy -> next_state`. Clients cannot directly assign authoritative state.

### P646 Approval Policies
Support SINGLE_APPROVER, ANY_ONE, ALL_REQUIRED, N_OF_M, SEQUENTIAL, and PARALLEL approval models.

### P647 Risk-based Approval
Approval thresholds are policy-driven and can vary by risk, amount, resource scope, organization, and action type.

### P648 Reviewer Eligibility
A reviewer must satisfy permission + scope + role + organization + policy + conflict-of-interest checks.

### P649 Four-eyes / Conflict of Interest
High-risk actions may require separation of initiator and approver. Self-approval and conflicted approval are denied unless an explicitly documented policy permits them.

### P650 Moderation vs Approval
Moderation is a safety/content assessment. Approval is authorization to perform a workflow transition. A moderation PASS does not automatically publish content.

### P651 Moderation Result
Initial moderation results: PASS, REJECT, REVIEW, LIMIT, BLOCK.

### P652 Moderation Reason Registry
Moderation reasons are machine-readable, versioned, auditable, and must not be replaced by free-form client state.

### P653 Appeal Workflow
Rejected/limited decisions may enter an explicit APPEAL_REVIEW workflow with independent transition and authorization rules.

### P654 Escalation
Workflow policies can escalate tasks by risk, timeout, reviewer availability, or repeated rejection.

### P655 Workflow Timeout
Timeout policy supports RETRY, ESCALATE, PAUSE, CANCEL, and EXPIRE.

### P656 Workflow Task Entity
Workflow tasks have explicit lifecycle states such as PENDING, ASSIGNED, IN_PROGRESS, APPROVED, REJECTED, EXPIRED, CANCELLED.

### P657 Workflow Idempotency
Workflow actions must be idempotent. Duplicate requests cannot create duplicate approvals, transitions, payments, or side effects.

### P658 Optimistic Concurrency
Workflow transitions use a state/version boundary so stale reviewers cannot overwrite newer state.

### P659 Workflow Audit
Every high-risk transition, approval, rejection, escalation, and appeal is linked to Audit with actor, scope, request/correlation identifiers, and reason.

### P660 Workflow Green Gate
Workflow Green requires Contract, Schema, OpenAPI, Permission, State, Mapping, Type, Build, Unit, Integration, E2E, Security, Audit, and Migration gates as applicable.

## P661–P680 — API Gateway / API Platform / Client Experience Layer

### P661 API Platform Principle
Web, Android, iOS, and Mini Program share Common Domain Contracts. Client-specific differences are handled through capability, context, projection, composition, and transport adaptation rather than separate business models.

### P662 API Versioning
Public APIs use explicit versions such as `/v1/...`. Version changes must be reflected in Contract, OpenAPI, SDK, examples, compatibility policy, and CI.

### P663 Compatibility Policy
Compatible changes include additive optional fields and documented extensions. Breaking changes include deletion, incompatible type/meaning changes, new required fields, authentication changes, and state-machine semantic changes. Breaking changes require an explicit gate.

### P664 Client Context
Request context may include platform, app_id, app_version, SDK version, device/network capability, and request metadata. Client context is for compatibility, experience, and observability; it is never a standalone authorization source.

### P665 Capability vs Permission
Capability describes what a client can render or perform. Permission describes what the subject is authorized to do. Capability limitations cause adaptation/degradation, not false FORBIDDEN responses.

### P666 API Projection
Persistence entities are not automatically public API responses. Public responses are Contract-defined projections that may combine entity, author, media, interaction, permission, and playback projections.

### P667 Hydration Boundary
Server-side API composition hydrates related projections so clients do not create uncontrolled N+1 request graphs. Hydration remains bounded and contract-defined.

### P668 BFF Boundary
BFF is permitted for client adaptation and composition. Core business rules remain in Domain Services and cannot be forked into separate iOS/Android/Mini Program business implementations.

### P669 API Composition
Page-level endpoints may compose stable domain projections, reducing request count and improving mobile/mini-program experience without creating a new business model.

### P670 Field Projection
Supported projections such as MINIMAL, CARD, DETAIL, and PLAYER must be contract-registered. Arbitrary client field selection cannot bypass authorization or expose internal/sensitive fields.

### P671 ETag / Conditional Requests
Read resources may use ETag/If-None-Match and 304 semantics where appropriate to reduce bandwidth and compute.

### P672 Cache-Control Contract
Cache behavior is contract-governed: PUBLIC, PRIVATE, NO_STORE, SHORT, LONG. Sensitive or user-specific resources default to private/no-store policies.

### P673 Client Cache Safety
Cache keys for user-specific data must include the relevant user/scope/version dimensions. A generic shared key must never expose one user's Feed, Permission, or private projection to another user.

### P674 Offline / Retry Contract
Retryability is explicit. Clients must not blindly retry all errors. State-changing operations use Idempotency-Key where duplicate execution could create side effects.

### P675 Optimistic UI
Client optimistic state is presentation state only. Server authority remains authoritative; failed operations must reconcile/rollback client state.

### P676 Upload / Download API
Media upload follows Upload Session -> Multipart/Resume -> Complete -> Processing -> READY. Playback follows Authorization -> Playback Session -> temporary manifest -> CDN. The public API does not proxy large media bytes.

### P677 API Rate Policy
Rate policies are domain/action-specific. Auth, payment, interaction, search, feed, upload, and high-risk APIs may have distinct limits. Rate limit is separate from permission and quota.

### P678 API Deprecation
APIs move through ACTIVE -> DEPRECATED -> SUNSET -> REMOVED with replacement, migration guidance, dates, and compatibility communication. Removal requires a breaking-change gate.

### P679 SDK Contract
SDKs are generated or derived from approved Contract/OpenAPI/Schema. SDK implementation cannot redefine public API semantics.

### P680 API Experience Green Gate
API Platform Green requires version, compatibility, client context, capability, projection, hydration, BFF boundary, cache, ETag, retry, idempotency, upload/download, rate policy, deprecation, SDK, API E2E, and security evidence as applicable.

## P681–P700 — Developer Platform / OpenAPI / SDK / Webhook / Partner API

### P681 Developer Platform Principle
Third-party access follows Developer App -> Authentication -> Authorization -> Scope -> Rate Limit -> API. Internal Domain Services are never directly exposed as third-party trust boundaries.

### P682 Developer Application
`DeveloperApp` is a first-class entity with owner, organization, client type, status, timestamps, and lifecycle. Initial states: ACTIVE, SUSPENDED, REVOKED, DELETED.

### P683 API Client Identity
User, Account, Organization, Developer App, and API Credential are distinct identities. An API credential represents an application credential, not an implicit administrator identity.

### P684 OAuth Boundary
User-delegated third-party access uses OAuth-style authorization rather than password sharing. Third-party applications must never require storage of platform user passwords.

### P685 OAuth Scopes
Scopes are fine-grained, e.g. `content:read`, `content:create`, `content:update`, `content:publish`, `media:read`, `media:upload`, `analytics:read`, `organization:read`. Wildcard administrative scopes are not normal defaults.

### P686 Scope + Entitlement + Permission
Effective authorization combines application scope, subject authorization, entitlement, organization scope, resource ownership, account state, and policy. No single token field is sufficient authority.

### P687 API Key
API keys are appropriate for controlled server-to-server integrations and selected low-risk APIs. Keys are not user sessions or universal admin credentials. Store only protected/hash representations where possible and support scope, expiration, rotation, revocation, and last-use tracking.

### P688 Key Rotation
Credential rotation supports overlapping old/new keys with a controlled grace period, followed by explicit revocation of the old credential.

### P689 Webhook Contract
Domain events may be delivered to third parties through a unified Webhook platform. Initial examples include CONTENT_PUBLISHED, CONTENT_OFFLINE, MEDIA_READY, PAYMENT_SUCCEEDED, and SUBSCRIPTION_CHANGED.

### P690 Webhook Envelope
Webhook payloads use a stable envelope with event id, type, version, occurrence time, source, and data. Event schemas are versioned.

### P691 Webhook Signature
Webhook delivery is signed, using a verifiable scheme such as HMAC, and includes timestamp/event identity to support authenticity and replay protection.

### P692 Webhook Replay Protection
Consumers deduplicate by stable event_id. Retries preserve the same event identity rather than generating new business events.

### P693 Webhook Retry
Delivery uses PENDING -> DELIVERING -> DELIVERED with transient failure retry, backoff, and eventual DLQ. Consumer failure must not fail the originating business transaction.

### P694 Webhook Ordering
Delivery order is not assumed unless explicitly contracted. Event version/sequence/occurred_at and consumer idempotency provide safe processing boundaries.

### P695 OpenAPI Source of Truth
The canonical direction is Schema/Contract -> OpenAPI -> SDK/Documentation. Handwritten documentation or framework-generated schemas cannot silently redefine the canonical API.

### P696 API Documentation
Every public API documents purpose, authentication, scopes, request/response, errors, pagination, idempotency, rate policy, examples, version, and deprecation information.

### P697 SDK Generation
Approved API contracts may generate TypeScript, Kotlin, Swift, and Mini Program SDKs. SDKs must preserve contract semantics and error/idempotency/pagination behavior.

### P698 Partner API
Partner APIs support controlled enterprise integrations such as content sync, media integration, analytics, commerce, and IP licensing through explicit Partner Contracts, scopes, quotas, and organization/resource boundaries.

### P699 Developer Abuse Protection
Developer access requires credential-abuse, scraping, quota-abuse, webhook-abuse, and anomalous-call detection. Enforcement actions include THROTTLE, CHALLENGE, SUSPEND, and BLOCK according to policy.

### P700 Developer Platform Green Gate
Developer Platform Green requires Developer App, OAuth, Scope, API Key, rotation, Webhook, signature, replay protection, retry/DLQ, OpenAPI, SDK, documentation, Partner API, abuse protection, and developer E2E evidence as applicable.

## P701–P720 — Recommendation / Ranking / Personalization Intelligence Platform

### P701 Recommendation Principle
Recommendation is an upstream decision system for Feed, not business logic embedded in Feed APIs. Clients consume stable Feed Contracts regardless of ranking implementation.

### P702 Recommendation Contract
Recommendation contracts live under `contracts/recommendation/` and cover schema, OpenAPI, candidates, ranking, features, experiments, policies, and states. A recommendation request can include feed type, cursor, client context, user context, and ranking version.

### P703 Candidate Generation
Candidate sources may include FOLLOWING, TRENDING, RECENT, TOPIC, CREATOR, SIMILAR_CONTENT, COLLABORATIVE, EDITORIAL, and SPONSORED sources under explicit policy.

### P704 Candidate vs Eligible
A candidate is not necessarily eligible. Visibility, account state, content state, permissions, safety, media readiness, block/mute relationships, and other policy checks must run before final ranking eligibility.

### P705 Safety First
Safety and eligibility constraints are applied before final recommendation ranking so unsafe/ineligible content does not consume the top-N ranking budget and leave unusable results.

### P706 Ranking Boundary
Ranking consumes candidates, features, context, and ranking version and produces internal ranking decisions. Scores and model internals are not public business fields.

### P707 Ranking Version
Every ranking policy/model is versioned. Feed cursors bind to ranking_version/filter/sort/cursor version so pagination remains stable across a session.

### P708 Feature Boundary
Recommendation features are grouped into User, Content, Creator, Context, Interaction, Media, and Temporal feature classes. Feature access follows privacy and authorization boundaries.

### P709 Feature Store Evolution
The initial implementation may use projections, database state, and cache. A dedicated online/offline feature store can be introduced later without changing public Feed APIs because the Feature Contract is frozen first.

### P710 Feature Registry
Each feature records feature_id, name, type, source, freshness, default, privacy classification, version, and owner. Example: `user.video_completion_rate` as a versioned analytics-derived feature.

### P711 Personalization
Personalization may use user history, following, topics, device/client context, session context, and permitted signals. Privacy, consent, account state, and authorization remain higher-order constraints.

### P712 Cold Start
New users receive safe baseline candidates such as editorial, trending, fresh, and policy-approved topic candidates. New content can receive bounded exploration rather than being invisible solely because it lacks historical interactions.

### P713 Exploration / Exploitation
Recommendation balances proven content with controlled exploration. The exact budget is policy/configuration, not a fixed public API guarantee.

### P714 Creator Fairness
Ranking supports exposure constraints such as creator exposure budget and new-creator opportunities while preserving quality-based ranking rather than equal distribution.

### P715 Content Diversity
Diversity policies include author, topic, content type, freshness, and duplicate-window constraints. Existing Feed constraints such as `max_same_author` and `max_same_topic` remain compatible with the recommendation layer.

### P716 Experiment / A-B Test
Experiments are first-class, versioned entities with stable assignment, population/allocation rules, start/end times, and status. Stable assignment prevents per-request experiment flipping and polluted metrics.

### P717 Recommendation Feedback
Impression, play, watch, completion, skip, like, comment, share, follow, not-interested, and report events feed analytics/recommendation feedback. Recommendation cannot directly mutate Content Authority.

### P718 Anti-gaming
Recommendation must not blindly use raw engagement. Raw, qualified, suspected, and invalid counts may be separated so fraud/manipulation does not directly determine ranking, creator reward, or monetization.

### P719 Recommendation Explainability / Audit
Internal recommendation traces record request/trace identity, candidate, ranking version, experiment, policy version, and relevant decision lineage. Internal model parameters are not exposed as public API contracts.

### P720 Recommendation Green Gate
Recommendation Green requires Contract, Candidate, Eligibility, Safety, Ranking, Feature, Personalization, Cold Start, Exploration, Diversity, Experiment, Feedback, Anti-gaming, Audit, and Recommendation E2E evidence as applicable.

## Architecture freeze after P720

The platform-level dependency direction is:

```text
Content / Interaction / Analytics / Search / Events
                    ↓
            Recommendation
                    ↓
      Candidate → Eligibility → Safety
                    ↓
                 Ranking
                    ↓
            Personalization
                    ↓
              Exploration
                    ↓
               Diversity
                    ↓
             Feed Projection
                    ↓
      Web / iOS / Android / Mini Program
```

The client-facing API remains stable while Candidate, Feature, Ranking, Experiment, and Policy implementations evolve behind the contract boundary.

## Development status rule

This document is a design landing record. `DOCUMENTED` does not imply `CONTRACT_GREEN`, `IMPLEMENTED`, `INTEGRATION_GREEN`, `E2E_GREEN`, `SECURITY_GREEN`, or `RELEASE_GREEN`. Those states require repository artifacts and current-SHA CI evidence.
