# LuckRead P0 Content and IP Graph Contract v1.0

**Status:** READY FOR IMPLEMENTATION

## 1. Goal

Create the durable content and IP foundation on which articles, dynamics, galleries, video, audio, novels, comics, drama, live, games and apps can be added without redefining identity or relationships.

## 2. Unified Content Identity

Every published or draft content object has:

- immutable `id`
- `contentType`
- `ownerUserId`
- optional `creatorId`
- optional `ipId`
- lifecycle `status`
- visibility policy
- canonical version
- created/updated timestamps

Content types are extensible. Initial types include article, dynamic, gallery, video, audio, novel, comic, drama, live-reference, game-reference and app-reference.

## 3. Lifecycle

```text
DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED
                         ↓
                       FAILED

PUBLISHED → HIDDEN → RESTORED
DRAFT/ARCHIVED → DELETED
```

Transitions must be explicit and auditable. A deleted object must not silently become published content.

## 4. Versioning

- Draft editing must not mutate the public canonical version unexpectedly.
- Published versions are immutable snapshots.
- Preview uses an explicit version.
- Rollback restores a known version rather than reconstructing content from UI state.
- Large body/media payloads may live in R2; D1 remains authoritative for metadata and references.

## 5. IP Graph

IP is a first-class entity independent from a single content item.

Core relations:

```text
User      --creates/controls--> Creator
Creator   --owns/controls-----> IP
Content   --belongs_to--------> IP
Series    --contains----------> Content
Episode   --part_of-----------> Series
Remix     --derived_from------> Content
Translation --translated_from-> Content
Adaptation --adapted_from-----> Content
License   --authorizes--------> Usage
Product   --monetizes---------> IP
Community --supports----------> IP
```

Relations must be typed, directional, auditable and extensible.

## 6. IP Entity Minimum Contract

An IP contains:

- immutable `id`
- name/title
- type/category
- owner/controller reference
- lifecycle status
- visibility
- canonical description/metadata
- created/updated timestamps

Future fields may include territories, brands, characters, universes and commercial rights without changing content identity.

## 7. Content Relationship Rules

A content item may have multiple graph edges. Examples:

- quote another item
- repost another item
- reference another item
- derive/remix another item
- translate another item
- adapt another item
- belong to a series/collection/channel
- be associated with an IP

The graph must not require copying source content into the target record.

## 8. Ownership and Permissions

- Content ownership is independent from display authorship.
- Creator authorization must be checked before publishing on behalf of a creator.
- IP control does not automatically grant unrestricted rights to every derivative work.
- Rights/copyright contracts remain the authority for licensing decisions.

## 9. API Boundary

Minimum versioned API surface:

- `POST /v1/content`
- `GET /v1/content/:id`
- `PATCH /v1/content/:id`
- `POST /v1/content/:id/publish`
- `POST /v1/content/:id/archive`
- `GET /v1/content/:id/relationships`
- `POST /v1/content/:id/relationships`
- `POST /v1/ip`
- `GET /v1/ip/:id`
- `PATCH /v1/ip/:id`
- `GET /v1/ip/:id/content`
- `GET /v1/ip/:id/relationships`

Public API DTOs must not expose Payload document internals.

## 10. Runtime Boundary

Payload owns authoritative CMS-style content administration and supported extension points.

App-owned API/domain logic owns:
- lifecycle orchestration
- IP graph semantics
- relationship validation
- authorization beyond basic Payload access
- domain events

Workers own asynchronous graph indexing, derived views and high-volume processing.

## 11. Events

Important domain events include:

- `content.created`
- `content.updated`
- `content.submitted`
- `content.published`
- `content.archived`
- `content.deleted`
- `content.relationship.created`
- `ip.created`
- `ip.updated`
- `ip.content.attached`
- `ip.relationship.created`

Events must carry entity ID, actor ID where applicable, event ID, event version, timestamp and correlation ID.

## 12. Acceptance Criteria

1. Content and IP IDs are stable.
2. Lifecycle transitions are explicit.
3. Published versions are reproducible.
4. Content can exist without an IP, but publishing into an IP requires a valid relation.
5. IP can contain multiple content types.
6. Relationship creation validates source/target existence and permitted relation type.
7. No duplicate authoritative relationship is created for the same relation key.
8. Unauthorized users cannot mutate another owner's content/IP.
9. API DTOs are independent from Payload internals.
10. Typecheck, local runtime and D1 migration pass.
11. No Payload Core source is modified or copied.

## 13. Implementation Admission

Implement after Identity Contract acceptance. Creator, recommendation, commerce, search and analytics may consume this contract but must not redefine content/IP identity.
