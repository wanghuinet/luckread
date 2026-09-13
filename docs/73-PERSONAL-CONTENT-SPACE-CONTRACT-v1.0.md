# LuckRead Personal Content Space Contract v1.0

## 1. Purpose

Personal Content Space defines the user's unified "My Content" experience: a single user-facing entry for discovering, managing, reviewing, organizing, and acting on content related to the current user.

It is an aggregation and experience layer. It MUST NOT become a second authoritative database for Content, Creator, Social, Interaction, Media, Live, Commerce, Wallet, Notification, or other domain systems.

## 2. Scope

The Personal Content Space covers:

- My published content
- Drafts and unpublished content
- Scheduled content
- Failed submissions and retryable items
- Saved / favorited content
- Liked content
- Watch / read history
- Continue watching / reading
- My comments and replies
- My follows and followed entities
- My media assets
- My series / collections
- My reposts / remixes where supported
- My live records where supported
- My novels / comics / drama / audio works where supported
- Deleted / archived content views where policy permits
- Content management shortcuts into Creator Center
- Personal data export and lifecycle controls

## 3. Non-Goals

This contract does NOT define:

- Content authoritative storage
- Creator authoritative storage
- Recommendation ranking logic
- Social graph authority
- Media processing authority
- Live infrastructure
- Commerce or wallet authority
- Notification delivery authority
- Moderation authority
- Copyright authority

Those capabilities remain owned by their respective domain contracts.

## 4. Experience Model

The primary navigation is:

```text
My
├── Profile
├── My Content
│   ├── Published
│   ├── Drafts
│   ├── Scheduled
│   ├── Failed
│   ├── Archived
│   └── Deleted / Recoverable
├── My Activity
│   ├── Likes
│   ├── Favorites
│   ├── Comments
│   ├── Shares / Reposts
│   └── History
├── Following
├── Followers
├── Media
├── Collections / Series
├── Continue Watching / Reading
├── Live
└── Creator Center
```

The exact UI can evolve without changing ownership boundaries.

## 5. Live Entry and Return Contract

The Personal Content Space MUST retain a visible **Live / 直播** entry point.

This entry is an experience/navigation capability and MUST NOT be removed merely because the Live infrastructure implementation is deferred.

```text
My
  ↓
Live / 直播
  ↓
Live Experience
  ↓
Back / Close
  ↓
Original Personal Content Space
```

Requirements:

- The Live button MUST remain present in the navigation contract.
- Clicking Live MUST open the Live experience without replacing the user's Personal Content Space state permanently.
- The originating navigation context MUST be preserved.
- Returning from Live MUST return the user directly to the previous Personal Content Space location whenever technically possible.
- The previous tab/filter/cursor/scroll position SHOULD be restored where safe and supported.
- If the Live experience fails to initialize, the user MUST be able to return immediately to Personal Content Space.
- Live entry MUST support future integration with an external/self-hosted Live implementation without changing the Personal Content Space navigation contract.
- Personal Content Space MUST NOT own Live room state, RTC state, stream state, participant state, or media transport state.

Recommended navigation state:

```text
PersonalContentSpaceState
├── entryPoint
├── selectedSection
├── filter
├── cursor
├── scrollPosition
└── returnTarget
```

The Live flow MUST treat `returnTarget` as navigation state only; it MUST NOT become a business-data authority.

## 6. Content Ownership Boundary

For every item shown in Personal Content Space, the system MUST retain a stable domain reference rather than copying the complete authoritative object.

```text
Personal Content Space
        ↓ reference
Domain Record
        ↓
Content / Creator / Social / Media / Interaction / Other Authority
```

The aggregation layer MAY maintain derived indexes, counters, ordering keys, snapshots, and cache entries for performance, but these MUST be reconstructible.

## 7. Content State Model

User-facing content management MUST distinguish at least:

```text
DRAFT
→ SUBMITTED
→ REVIEWING
→ PUBLISHED
→ SCHEDULED
→ REJECTED / FAILED
→ ARCHIVED
→ DELETED / RECOVERABLE
→ PURGED
```

The authoritative state belongs to the owning domain. Personal Content Space only presents and filters that state.

## 8. Drafts

Drafts are first-class user work products.

Requirements:

- Auto-save where supported
- Manual save
- Last-edited timestamp
- Local/network failure recovery
- Conflict detection for multiple editing sessions
- Explicit discard
- Restore where safe
- Draft ownership enforcement
- No accidental publication
- Draft visibility MUST remain private unless explicitly submitted

Draft persistence belongs to the Content / Production domain; Personal Content Space provides the management entry.

## 9. Published Content

The published list MUST support:

- Pagination / cursor navigation
- Content type filtering
- Status filtering
- Time filtering
- Search within user's content
- Sort by newest / oldest / engagement where authorized
- Visibility state
- Moderation state
- Publication timestamp
- Basic derived metrics

Metrics are read models and MUST NOT become authoritative accounting records.

## 10. Scheduled Content

Scheduled items MUST expose:

- Scheduled publication time
- Time zone
- Current status
- Cancellation
- Rescheduling where allowed
- Validation failures
- Publication result

Scheduling execution belongs to the Content / Platform scheduling domain.

## 11. Failed / Rejected Content

The user MUST be able to understand why an operation failed without exposing internal security-sensitive details.

Supported states include:

- Upload failure
- Validation failure
- Moderation rejection
- Rights failure
- Processing failure
- Scheduling failure
- Temporary service failure

Retry MUST be idempotent and MUST NOT create duplicate authoritative content.

## 12. Likes / Favorites / History

Personal Content Space may aggregate:

- Content liked by the user
- Content favorited by the user
- Recently viewed content
- Recently watched content
- Recently read content
- Continue-watching / continue-reading positions

These records are owned by Interaction / Activity / Media domains as applicable.

History MAY have configurable retention and privacy controls.

## 13. Comments and Replies

The user can access:

- Comments authored by the user
- Replies authored by the user
- Replies received by the user
- Moderation state where applicable
- Link back to the original content

Deletion, moderation, appeal, and visibility decisions remain owned by the Comment / Moderation domains.

## 14. Following and Followers

Personal Content Space provides navigation into:

- Following list
- Followers list
- Mutual relationships where supported
- Follow requests where supported
- Blocked / muted relationships where policy permits

The Social Graph remains authoritative.

## 15. Media Space

My Media MAY include:

- Uploaded images
- Video assets
- Audio assets
- Cover images
- Attachments
- Unused assets
- Processing states
- Failed assets

Media objects MUST reference the Media domain and MUST NOT duplicate binary objects into the Personal Content Space.

## 16. Collections / Series

Users MAY organize content into:

- Collections
- Playlists
- Series
- Reading lists
- Watch lists
- Custom folders where supported

Collection ownership and membership semantics MUST be explicitly defined by the owning domain.

## 17. Creator Center Boundary

Personal Content Space MUST provide a clear transition for users who want to create content:

```text
Normal User
   ↓
Create / Publish
   ↓
Creator Onboarding
   ↓
Creator Center
```

Registration MUST NOT require creator creation.

Creator Center remains the authoritative experience for creator operations, analytics, monetization, publishing workflows, and creator tools.

## 18. Content Types

The aggregation contract MUST be extensible to at least:

- Article
- Post / Dynamic
- Image gallery
- Short video
- Long video
- Audio / Podcast
- Novel
- Comic
- Drama / Series
- Live record
- Collection / Playlist
- Remix / Repost

Adding a new content type MUST NOT require redesigning the Personal Content Space contract.

## 19. API Contract

Representative APIs:

```text
GET    /v1/me/content
GET    /v1/me/content?status=draft
GET    /v1/me/content?status=published
GET    /v1/me/content?type=video
GET    /v1/me/activity/likes
GET    /v1/me/activity/favorites
GET    /v1/me/activity/history
GET    /v1/me/comments
GET    /v1/me/following
GET    /v1/me/followers
GET    /v1/me/media
GET    /v1/me/collections
GET    /v1/me/continue
GET    /v1/me/live
```

The Live API here is only a user-specific navigation/history surface. It MUST NOT imply that Personal Content Space owns Live infrastructure.

Mutation examples:

```text
POST   /v1/me/content/{id}/retry
POST   /v1/me/content/{id}/archive
POST   /v1/me/content/{id}/restore
DELETE /v1/me/content/{id}
DELETE /v1/me/activity/history/{id}
```

Every mutation MUST enforce user ownership, authorization, idempotency where applicable, and domain-level validation.

## 20. Query Contract

All list APIs SHOULD support:

- Cursor pagination
- Stable ordering
- Explicit filters
- Type-safe response envelopes
- Partial failure handling where aggregation crosses multiple domains
- Request correlation ID
- Cache metadata where useful

Offset pagination MUST NOT be the only mechanism for large user histories.

## 21. Aggregation Failure Model

Personal Content Space may depend on multiple services/domains.

A single downstream failure MUST NOT unnecessarily make the entire user center unusable.

```text
User Request
   ↓
Personal Content Aggregator
   ├── Content
   ├── Interaction
   ├── Social
   ├── Media
   ├── Creator
   ├── Live Navigation / History
   └── Other Domains
```

Requirements:

- Per-domain timeout
- Partial response where safe
- Circuit breaking
- Cache fallback where safe
- Explicit degraded-state metadata
- No fabricated authoritative data
- No cross-domain transaction requirement for read aggregation

Live-specific failure MUST degrade only the Live area where possible and MUST preserve an immediate return path to Personal Content Space.

## 22. Event Contract

Representative events:

```text
content.created
content.updated
content.published
content.archived
content.deleted
content.restored
content.publish_failed
interaction.liked
interaction.unliked
interaction.favorited
interaction.unfavorited
comment.created
comment.deleted
social.followed
social.unfollowed
media.created
media.processing.completed
media.processing.failed
```

Personal Content Space MAY consume these events to maintain derived indexes and caches.

Event consumption MUST be idempotent.

## 23. Cache Contract

Cacheable data includes:

- User content list
- Recent history
- Favorite lists
- Media summaries
- Collection summaries
- Derived counts
- Live entry/history summaries

Cache MUST be treated as disposable.

No security or authorization decision may rely solely on stale cache state.

## 24. Privacy

The system MUST respect:

- Content visibility
- Private / unlisted content
- Deleted content rules
- History privacy
- Collection privacy
- Block / mute rules
- Account restrictions
- Regional policy
- Data retention policy

Private data MUST never leak through aggregated list APIs.

## 25. Security

Every Personal Content Space request MUST establish:

- authenticated identity where required
- resource ownership
- authorization
- account status
- applicable privacy restrictions
- abuse/rate limits

IDs MUST NOT be treated as authorization.

## 26. Performance Contract

P0 targets:

- Cursor-based pagination for large lists
- Bounded aggregation fan-out
- Avoid N+1 domain calls
- Cache hot read models
- Batch background refreshes
- Do not synchronously calculate expensive analytics for ordinary user-center requests
- Do not synchronously fetch large media objects merely to render a list
- Live navigation MUST return without requiring Personal Content Space to wait for unrelated downstream systems

## 27. Data Lifecycle

Personal indexes follow the source domain lifecycle:

```text
Source Created
→ Indexed
→ Updated
→ Archived / Deleted
→ Retention Window
→ Derived Index Purge
```

Deletion propagation MUST be deterministic and auditable.

## 28. Account Deletion Interaction

When an account enters deletion workflow:

- Personal indexes become unavailable according to policy
- Private drafts are protected from accidental exposure
- Domain-owned content follows the Content retention/deletion policy
- Activity history follows privacy/retention policy
- Derived caches are invalidated
- Search/discovery indexes receive deletion signals
- Export eligibility is evaluated before final purge

Personal Content Space MUST NOT independently resurrect deleted account data.

## 29. UX Requirements

Every major list MUST define:

- Empty state
- Loading state
- Pagination end state
- Network failure state
- Permission denied state
- Deleted/unavailable item state
- Moderated item state where relevant
- Retry action where safe

The Live entry additionally MUST define:

- Live button visible state
- Live loading state
- Live unavailable state
- Live initialization failure state
- Back / close state
- Return-to-origin state
- Preservation of safe navigation context

The experience should remain understandable even when a referenced domain object is no longer available.

## 30. Observability

The system SHOULD record:

- Aggregation latency
- Downstream latency
- Partial failure rate
- Cache hit rate
- List query volume
- Retry rate
- Broken reference rate
- Deletion propagation latency
- Event processing lag
- Live entry initialization latency
- Live return/navigation failure rate

Observability data MUST NOT expose private content unnecessarily.

## 31. Acceptance Criteria

The contract is considered implementation-ready only when all are defined:

- Published content list
- Draft list
- Scheduled content
- Failed/rejected content
- Likes
- Favorites
- History
- Comments
- Following/followers
- Media
- Collections
- Continue reading/watching
- Persistent Live / 直播 entry
- Live open and immediate return behavior
- Preservation of originating navigation context where supported
- Creator Center transition
- Content type extensibility
- Cursor pagination
- Authorization
- Privacy enforcement
- Partial aggregation failure
- Cache behavior
- Event idempotency
- Account deletion propagation
- Empty/error/degraded UX states

## 32. STOP Conditions

Implementation MUST STOP if:

- Personal Content Space becomes a second content database
- Domain ownership is ambiguous
- An API exposes another user's private content
- A mutation lacks authorization
- Deletion semantics are undefined
- Cross-domain synchronous transactions are introduced without an approved contract
- Large lists depend only on offset pagination
- Retry can create duplicate authoritative content
- Cache becomes authoritative
- A new content type requires breaking the existing aggregation contract
- Live navigation permanently loses the user's originating Personal Content Space state without an approved UX exception

## 33. Admission Status

Status: **READY FOR IMPLEMENTATION**

This document defines the Personal Content Space boundary, ownership model, API surface, event model, privacy/security requirements, failure model, lifecycle, performance requirements, Live navigation/return contract, and acceptance criteria.

Implementation remains blocked until the project-level contract admission process authorizes code changes.
