# Payload Capability Map

## 1. Objective

This document freezes the first boundary between Payload CMS core responsibilities and capabilities that may be extracted to Workers/services later.

Primary goal:

> Keep Payload focused on CMS, content management, administration and transactional application CRUD so its Worker/runtime footprint does not grow into the entire product backend.

The boundary is designed **before feature implementation** so later extraction does not require rewriting large amounts of business code.

## 2. Boundary rule

There are three classes:

- **P0 — Payload Core / Do Not Extract**: tightly coupled to Payload's CMS/runtime model or provides the minimum application foundation.
- **P1 — Payload-Owned but Extractable by Contract**: may remain in Payload initially, but must be accessed through a stable service/domain contract so it can move later without changing clients.
- **P2 — Worker/Service First**: should not become Payload business logic; implement outside Payload from the beginning.

The default choice is not "split everything". The objective is **small Payload + clean boundaries + minimum future migration work**.

## 3. P0 — Payload Core / Do Not Extract

These capabilities remain in Payload unless the entire CMS foundation is intentionally replaced.

### 3.1 CMS administration

- Payload Admin UI
- collection configuration
- field definitions
- validation integrated with collections
- admin navigation
- CMS configuration
- collection-level admin presentation

Reason: these capabilities define Payload's primary purpose. Extracting them would mean rebuilding the CMS.

### 3.2 Authentication foundation

- Payload auth collection integration
- credential authentication foundation
- password lifecycle handled by Payload auth
- auth-related admin operations
- session/token integration required by Payload

The public product may later place an API gateway or identity service in front, but the Payload authentication contract must remain isolated from business collections.

### 3.3 Authorization foundation

- collection access control
- role-aware access checks
- field-level access where appropriate
- administrative authorization

Business-specific permission decisions may be wrapped by application services, but the Payload access layer remains the CMS security foundation.

### 3.4 Collection CRUD

- normal create/read/update/delete for CMS-managed entities
- Payload validation
- collection hooks required for CMS integrity
- ordinary admin editing

CRUD should remain simple. High-volume mutation paths must not be forced through Payload.

### 3.5 Content authoring foundation

- drafts
- revisions/versions where used
- autosave where used
- localization
- content validation
- editorial metadata

These are CMS functions and should remain Payload-owned.

### 3.6 Media management foundation

- Media collection metadata
- upload metadata
- relationship between CMS records and media objects
- R2 storage adapter integration

The actual large-object processing pipeline can be external, but Payload remains the authoritative CMS metadata manager.

## 4. P1 — Payload-Owned Initially, Extractable by Contract

These capabilities may start inside Payload for simplicity, but their domain service interface must be defined before implementation.

### 4.1 Publishing lifecycle

Initial implementation may use Payload drafts/status fields/hooks.

Contract:

```text
submit -> review -> approve/reject -> schedule -> publish -> unpublish
```

Later, an Enterprise Publishing Workflow or an external workflow service may implement the same contract.

### 4.2 Audit trail

Initial implementation may use Payload versions/hooks and application audit records.

Contract:

```text
actor + action + resource + before + after + timestamp + correlation_id
```

The public API must not depend on a specific Payload audit implementation.

### 4.3 Creator / profile management

Creator profiles can initially be Payload collections. High-volume creator statistics must not be stored as frequently mutated Payload fields.

Separate:

```text
creator identity/profile -> Payload
creator counters/ranking -> Worker/service
```

### 4.4 Content taxonomy

Categories, tags, topics and editorial metadata may remain Payload-owned. Large-scale recommendation features using those signals belong outside Payload.

### 4.5 Search metadata

Payload may own canonical content fields. Search indexing and query serving must use an external contract so the search implementation can later move to a dedicated service.

### 4.6 Notification templates/configuration

Payload may manage notification templates and administrative configuration. Actual fan-out, delivery, retries and high-volume queues belong outside Payload.

### 4.7 AI-assisted editorial features

AI requests must be abstracted behind an application-owned provider contract.

```text
AIProvider
  -> generate
  -> summarize
  -> translate
  -> classify
  -> embed
```

Payload Enterprise AI may later become one implementation; it must not become the only implementation.

## 5. P2 — Worker/Service First

These capabilities should be designed outside Payload from the first implementation.

### 5.1 Feed

- feed assembly
- ranking
- recommendation
- hot content calculation
- fan-out strategies
- personalized timelines

Reason: high read volume, specialized algorithms and independent scaling.

### 5.2 High-volume counters

- likes counters
- comments counters
- follows counters
- bookmarks counters
- views/read counters
- shares
- engagement aggregates

Payload should not receive one CMS transaction for every high-frequency event.

### 5.3 Event ingestion and asynchronous processing

- event queue
- retries
- delayed jobs
- scheduled processing
- fan-out
- batch aggregation
- webhook/event consumers

### 5.4 Notifications

- notification fan-out
- delivery queues
- push notification delivery
- email/SMS integration
- retry/dead-letter handling
- unread-count aggregation at scale

Payload may store templates/configuration, but not the hot delivery path.

### 5.5 Search engine

- indexing pipeline
- full-text search
- ranking
- autocomplete
- search analytics

Payload remains the canonical content source; the search service owns the index.

### 5.6 Video/media processing

- transcoding
- thumbnails
- waveform extraction
- media inspection
- asynchronous media jobs
- large-file processing

Payload owns media metadata; Workers/services process the objects.

### 5.7 Live

- live session coordination
- stream lifecycle
- real-time audience events
- chat at scale
- recording jobs

Payload can manage administrative metadata/configuration.

### 5.8 IM / realtime

- WebSocket/realtime connections
- message fan-out
- presence
- delivery receipts
- typing state
- high-volume message storage/processing

Payload is not the realtime transport layer.

### 5.9 Risk control

- rate limiting
- abuse detection
- spam detection
- high-frequency behavior analysis
- IP/device risk signals
- automated moderation pipelines

Payload may provide administrative review UI and final moderation records.

### 5.10 Analytics

- event collection
- aggregation
- dashboards requiring large event volumes
- recommendation signals
- product telemetry

Payload may own low-volume administrative configuration only.

## 6. Special rule: comments, likes, follows and bookmarks

These are split by traffic pattern, not simply by entity name.

### Canonical records

Payload may own the ordinary CMS/application records where appropriate.

### Hot path

The following must have an application/Worker contract from the beginning:

```text
like event
comment event
follow event
bookmark event
view event
share event
```

The high-volume write path must not be coupled directly to Payload Admin or Payload CRUD.

## 7. Enterprise capability mapping

| Capability | Open-source baseline | Enterprise enhancement | Boundary |
|---|---|---|---|
| Auth | Payload | SSO | Payload auth + IdentityProvider adapter |
| Access control | Payload | Enterprise identity integration | Payload + adapter |
| Draft/version | Payload | richer editorial workflow | Payload |
| Publishing workflow | application/Payload baseline | Enterprise workflow | PublishingState contract |
| Visual editing | custom/admin baseline | Enterprise Visual Editor | UI capability adapter |
| Collaboration | normal editing | multi-player editing | editorial capability adapter |
| AI | external provider/app integration | Enterprise AI | AIProvider |
| Embeddings/RAG | external provider/app integration | Enterprise AI capabilities | EmbeddingProvider |
| A/B testing | application implementation | Enterprise capability | Experiment contract |
| SSO | application auth/IdP integration | Enterprise SSO | IdentityProvider |
| Support | project operations | Enterprise support | operational, not runtime dependency |

## 8. Rules preventing Payload growth

### Rule A — No hot-path business loop in Payload

Do not put per-like, per-view, per-notification or per-message processing into Payload hooks.

### Rule B — No algorithmic engine in Payload

Recommendation, ranking, feed assembly and risk scoring are not Payload collection hooks.

### Rule C — Hooks must remain bounded

A Payload hook may enforce local data integrity or emit an event. It must not become a long-running orchestration engine.

Preferred:

```text
Payload mutation
   -> validate local invariant
   -> commit
   -> emit domain event
   -> Worker processes asynchronously
```

Avoid:

```text
Payload mutation
   -> call 8 services
   -> recompute feed
   -> send notifications
   -> process media
   -> update analytics
```

### Rule D — Collections are not service boundaries

A collection can remain in Payload while its high-volume behavior is served by another service. The domain contract, not the collection implementation, is the stable boundary.

### Rule E — Enterprise is never a hard dependency

Enterprise capabilities may replace an implementation behind an existing contract. They must not redefine the application's public API or logical database model.

## 9. Target Payload footprint

Payload should primarily contain:

```text
CMS
Admin
Auth
Authorization
Collections
Validation
Editorial workflow foundation
Content metadata
Media metadata
API facade
```

It should not gradually accumulate:

```text
Feed engine
Recommendation engine
Queue engine
Realtime engine
Video processing engine
Search engine
Notification delivery engine
Analytics pipeline
Risk engine
```

## 10. Extraction strategy

Every P1 capability must have an interface before implementation.

Example:

```text
PublishingService
SearchIndexer
NotificationService
AIProvider
IdentityProvider
AuditService
```

The first implementation may be local/Payload-backed. A later Worker implementation must satisfy the same contract.

This prevents a large refactor when traffic grows.

## 11. Decision matrix

| Capability | Class | Initial owner | Future extraction |
|---|---|---|---|
| Admin | P0 | Payload | No |
| Auth | P0 | Payload | No, except deliberate identity architecture change |
| Access control | P0 | Payload | No |
| CMS CRUD | P0 | Payload | No |
| Draft/version | P0 | Payload | No |
| Localization | P0 | Payload | No |
| Media metadata | P0 | Payload | No |
| Publishing workflow | P1 | Payload/app contract | Yes |
| Audit | P1 | Payload/app contract | Yes |
| Creator profile | P1 | Payload | Yes if scale requires |
| Search indexing | P2 | Worker/service | Yes/replaceable |
| Feed | P2 | Worker/service | N/A |
| Recommendation | P2 | Worker/service | N/A |
| Counters | P2 | Worker/service | N/A |
| Queue | P2 | Worker/service | N/A |
| Notifications | P2 | Worker/service | N/A |
| Video processing | P2 | Worker/service | N/A |
| Live | P2 | Worker/service | N/A |
| IM/realtime | P2 | Worker/service | N/A |
| Risk control | P2 | Worker/service | N/A |
| Analytics | P2 | Worker/service | N/A |
| AI | P1 | provider abstraction | Yes |

## 12. Acceptance gate

Before any new feature is implemented, classify it as P0/P1/P2.

A feature is **not admitted** if its owner is ambiguous.

For P1 features, the contract must exist before code.

For P2 features, Payload code is prohibited unless an ADR explicitly approves an exception.

**Status: Architecture baseline — proposed for review.**