# LuckRead P0 Payload Extension and API Completeness Constraint v1.0

**Status:** MANDATORY ARCHITECTURE CONSTRAINT

## 1. Purpose

LuckRead is a Payload extension project, not a Payload fork.

The primary engineering objective is:

> Extend Payload through supported extension mechanisms while preserving Payload Core, and ensure every implemented product capability has a stable application API contract.

This document is a non-negotiable admission constraint for all future self-media features.

## 2. Core Preservation Rule

Ordinary self-media development MUST NOT modify Payload Core source code.

The preferred implementation order is:

```text
Payload Core
    ↓
Official extension points
    ↓
Fields / Collections / Hooks / Access / Endpoints / Plugins
    ↓
LuckRead Domain Layer
    ↓
Application API Contract
    ↓
H5 / Android / iOS / future clients
```

### 2.1 Forbidden by default

- modifying Payload Core source;
- copying Payload Core modules into the application;
- maintaining a long-lived private Payload fork for ordinary product features;
- changing Payload internals merely to make a business feature easier to implement;
- exposing Payload internal document shapes as the public APP contract.

### 2.2 Exception process

A Payload Core modification is permitted only after an ADR records:

1. why supported extension points are insufficient;
2. exact Core surface affected;
3. compatibility and upgrade impact;
4. security/data-integrity impact;
5. rollback strategy;
6. regression coverage;
7. responsible owner;
8. explicit approval.

The modification must be minimal and isolated.

## 3. Fields-First Extension Rule

Adding fields to an existing Payload collection is preferred when the requirement is a direct extension of that entity's identity, profile or metadata.

Examples:

```text
User
 ├── profile fields
 ├── creator profile fields
 └── account preferences

Content
 ├── editorial metadata
 ├── publication metadata
 └── content classification
```

A dedicated domain Collection/contract MUST be created when the capability has independent:

- lifecycle;
- ownership;
- permissions;
- relationships;
- API surface;
- audit requirements;
- state machine;
- independent evolution needs.

Do not create an ever-growing User or Content collection simply to avoid modeling a real business domain.

## 4. API Completeness Rule

A business capability is incomplete if it exists only as Payload fields, collections or Admin UI.

Every approved capability MUST have both a logical implementation model and a public application API contract before implementation reaches `READY`.

```text
Product Capability
      ↓
Feature Matrix
      ↓
Schema / Fields / Collection
      ↓
Domain Contract
      ↓
API Contract
      ↓
DTO + Permission + Lifecycle + Error + Consistency
      ↓
APP consumption
```

Payload-generated REST endpoints may be used internally or as an implementation mechanism. Public clients MUST NOT depend on Payload document internals, undocumented response shapes or Payload-specific URLs.

## 5. Required API Contract Contents

Every capability that can be consumed by an APP must define, as applicable:

- resource identity;
- list/read/create/update/delete operations;
- domain actions;
- request DTO;
- response DTO;
- authentication;
- authorization;
- ownership rules;
- lifecycle/state transitions;
- pagination/cursor;
- idempotency;
- consistency semantics;
- error codes;
- rate/risk controls;
- cache behavior;
- event behavior;
- cost/performance expectations;
- acceptance tests.

An API may expose fewer CRUD operations when the domain is intentionally command-oriented, but the omission must be explicit in the contract.

## 6. IP Center Mandatory Contract

The IP Center is a first-class domain. It MUST NOT be treated as merely a collection of fields with no application API.

Minimum logical model:

```text
IP
 ├── id
 ├── name/title
 ├── type/category
 ├── owner/controller
 ├── lifecycle status
 ├── visibility
 ├── description/metadata
 ├── creators
 ├── content relationships
 ├── rights/copyright references
 └── timestamps
```

Minimum public API surface:

```text
POST   /api/v1/ips
GET    /api/v1/ips
GET    /api/v1/ips/{id}
PATCH  /api/v1/ips/{id}
DELETE /api/v1/ips/{id}

GET    /api/v1/ips/{id}/profile
GET    /api/v1/ips/{id}/content
GET    /api/v1/ips/{id}/creators
GET    /api/v1/ips/{id}/relationships
GET    /api/v1/ips/{id}/stats

POST   /api/v1/ips/{id}/relationships
POST   /api/v1/ips/{id}/report
```

Actual endpoint naming may be refined by the OpenAPI contract, but the capability families above MUST remain covered.

IP API DTOs MUST be independent of Payload document internals.

## 7. Every Domain Must Have APP Output

The following rule applies to all current and future self-media domains:

```text
User
Creator
MCN
Content
Media
IP
Comment
Like
Favorite
Follow
Feed
Notification
Search
Moderation
Live
Video
IM
Mini App
Game
Commerce
Analytics
```

For each domain:

```text
Schema
 ↓
OpenAPI
 ↓
DTO
 ↓
Permission
 ↓
Lifecycle
 ↓
API implementation
 ↓
Contract CI
```

A domain MUST NOT enter implementation solely because its Payload collection works in Admin.

## 8. Payload Boundary

Payload remains responsible primarily for:

```text
CMS
Admin
Auth foundation
Authorization foundation
Collections
Validation
Draft/version/localization
Editorial workflow foundation
Canonical metadata
Media metadata
```

Business capabilities that require high-volume or specialized processing should use application services, Workers, queues, caches, R2 or other approved infrastructure behind stable contracts.

Payload hooks MUST remain bounded. A hook may validate local invariants or emit an event; it MUST NOT become a long-running orchestration engine.

## 9. Upgrade Compatibility Gate

The project must preserve the ability to upgrade Payload without rewriting the self-media domain layer.

Target property:

```text
Payload upgrade
      ↓
Payload Core remains upstream-compatible
      ↓
LuckRead extension layer remains intact
      ↓
Contract CI
      ↓
Typecheck / tests / regression
      ↓
PASS
```

Any change that materially weakens this property requires an ADR.

## 10. Implementation Admission Gate

A feature is admitted to implementation only when all applicable gates pass:

```text
Feature Matrix
      ↓
Payload Boundary Classification
      ↓
Schema / Domain Contract
      ↓
OpenAPI / API Contract
      ↓
Permission + Lifecycle + Error + Consistency
      ↓
Payload Core Preservation Check
      ↓
Contract CI
      ↓
Implementation
```

A feature is `BLOCKED` when:

- owner/boundary is ambiguous;
- API surface is missing;
- API DTO exposes Payload internals;
- required permissions are undefined;
- lifecycle is undefined where applicable;
- a Core modification has no approved ADR;
- Contract CI fails.

## 11. Completion Gate

A feature is `DONE` only when:

```text
Architecture PASS
    ↓
Contract PASS
    ↓
Payload Boundary PASS
    ↓
Code PASS
    ↓
CI PASS
    ↓
API consumption PASS
```

Admin functionality alone is never sufficient evidence of completion.

## 12. Governance Principle

This constraint exists to prevent two architectural failures:

### Failure A — Payload fork growth

```text
Self-media requirement
       ↓
Modify Payload Core
       ↓
More Core modifications
       ↓
Private fork
       ↓
Upgrade becomes expensive/risky
```

### Failure B — Backend capability without APP API

```text
Payload Collection works
       ↓
Admin can edit it
       ↓
No stable API contract
       ↓
APP cannot reliably consume it
```

The approved architecture is:

```text
Stable Payload Core
       +
Thin, explicit extension layer
       +
Domain contracts
       +
Complete versioned APP APIs
       +
Contract CI
```

This rule is mandatory for all future LuckRead self-media development.