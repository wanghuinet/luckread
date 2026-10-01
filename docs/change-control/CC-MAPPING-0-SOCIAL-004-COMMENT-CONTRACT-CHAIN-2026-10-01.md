# Change Control: SOCIAL-004 Comment Entity / Field / DTO / Persistence Contract Binding — 2026-10-01

**Status:** CONTRACTED_PARTIAL / IMPLEMENTATION_NOT_AUTHORIZED

## Decision

The SOCIAL-004 contract chain is now structurally bound through API, DTO, Entity, Field and logical D1-02 Persistence contracts without changing the fixed 12-Worker / 4-D1 topology.

### Canonical bindings

- API:
  - `GET /v1/content/{contentId}/comments` → `getContentContentIdComments`
  - `POST /v1/content/{contentId}/comments` → `postContentContentIdComments`
- DTO: `contracts/dto/social-comment.v1.json`
- Entity: `ENT-SOCIAL-COMMENT`
- Field contract: `contracts/entity/entity-field-contract-social-004-comment.v1.json`
- Persistence: `social_comments` logical table in D1-02, W05 authority
- Lifecycle state: `contracts/enums/comment-state.json`

## Bounded model

The minimum contracted fields are:
`commentId`, `authorUserId`, `contentId`, nullable `parentCommentId`, `body`, `state`, `createdAt`.

Parent comments must remain inside the same `contentId` scope. `authorUserId` is server-resolved and not client-authoritative. Moderation decision data is not duplicated into Comment.

## Explicit non-decisions

This change does **not**:
- create or execute a migration;
- add a new Worker or D1;
- add a Payload Collection;
- grant W05 runtime admission;
- bind a concrete block/privacy/moderation decision API;
- expose internal author identifiers;
- claim concurrency, security, E2E or Evidence Registry verification.

## Remaining gate

SOCIAL-004 remains UNRESOLVED for final Mapping/Evidence promotion until migration, policy inputs, W05 runtime, concurrency/security/E2E and remote runtime evidence are admitted and verified.
