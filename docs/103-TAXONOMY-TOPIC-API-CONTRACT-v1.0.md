# LuckRead Taxonomy / Topic / Hashtag / Entity API Contract v1.0

**状态：API-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. API Surface

```text
GET    /v1/taxonomies
POST   /v1/taxonomies
PATCH  /v1/taxonomies/:id
GET    /v1/topics
POST   /v1/topics
GET    /v1/topics/:id
PATCH  /v1/topics/:id
POST   /v1/topics/:id/merge
POST   /v1/topics/:id/split
POST   /v1/hashtags/resolve
POST   /v1/classifications
DELETE /v1/classifications/:id
GET    /v1/entities/:id/classifications
```

## 2. Mutation Requirements

Every mutation requires:

```text
requestId
actorId
scope
permission
validated DTO
idempotencyKey where applicable
expectedVersion where concurrent
stable error model
audit classification
```

## 3. Resolution Rules

Hashtag resolution returns a canonical topic or an explicitly unresolved result. Clients cannot create competing canonical identities through aliases.

## 4. Merge / Split

Merge and split are privileged, versioned operations. Existing references must migrate deterministically and preserve provenance.

## 5. Pagination / Rate

Collection APIs use cursor pagination and bounded page sizes. Public resolution endpoints are rate limited and abuse protected.

## 6. Security

No API exposes internal D1 schema, ranking scores, moderation thresholds, private evidence or Payload internals.
