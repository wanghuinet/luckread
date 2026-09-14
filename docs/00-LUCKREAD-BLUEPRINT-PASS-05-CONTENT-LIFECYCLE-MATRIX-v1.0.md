# Luckread Blueprint Pass 05 — Content Full Lifecycle Matrix v1.0

> Status: **CLOSURE PASS 05 / BLUEPRINT ONLY**
> Scope: complete lifecycle coverage for articles, galleries, video, audio, live, and extensible content types.
> Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` plus blueprint closure passes 02–04.

## 1. Objective

Every content object must have a defined lifecycle from creation to final disposition. CRUD is insufficient. Publication, moderation, distribution, recommendation/search eligibility, monetization, rights, derived media, analytics, notifications, cache invalidation, unpublish, archive, restore, and deletion must be explicitly connected.

## 2. Canonical content lifecycle

`idea → draft → autosaved → revised → review_pending → approved/rejected → scheduled → published → distributed → discoverable → interacted/monetized → updated/unpublished → archived/restored OR deleted`

Not every content type uses every state, but every type must declare which states are supported and which transitions are legal.

### 2.1 Orthogonal state dimensions

Do not encode all lifecycle concerns in one status field. At minimum keep these dimensions conceptually separate:

- editorial state
- publication state
- moderation state
- visibility state
- monetization/entitlement state
- rights/licensing state
- media processing state
- localization/translation state
- deletion/retention state
- ownership state
- recommendation/search eligibility

## 3. Content-type coverage

| Content type | Feature IDs | Required lifecycle additions |
|---|---|---|
| Article | ARTICLE-001..012, CONTENT-001..012 | rich text, revisions, review, schedule, canonical URL, paywall, translation |
| Gallery | ARTICLE-003, MEDIA-001..003 | ordered assets, cover, asset readiness, rights, CDN delivery |
| Short video | MEDIA-005, MEDIA-001..015 | upload/transcode/poster/subtitle/moderation/fingerprint/distribution |
| Long video | MEDIA-006, MEDIA-001..015 | chapters/seek metadata, processing, paywall, replay/rights |
| Audio/podcast | MEDIA-007..015 | episode/series, transcript, artwork, delivery, rights |
| Live | MEDIA-011..012 | scheduled/live/ended/replay, stream health, moderation, replay processing |
| Series/column | ARTICLE-004/005, MON-003..011 | ordered content, access policy, aggregate discovery/analytics |
| Novel/comic/drama/course/ebook | EXTCONTENT-001..005 | type-specific chapters/episodes/units plus shared publication/rights/access lifecycle |
| Game/community content | EXTCONTENT-006 | release/version/community/rights/moderation lifecycle |

## 4. Creation and ownership

### 4.1 Draft

A draft must have:

- authoritative owner;
- content type;
- visibility policy;
- locale/language;
- creation/update timestamps;
- revision/version identity;
- autosave semantics where supported;
- collaborator scope where enabled;
- draft-level authorization;
- audit trail for privileged changes.

### 4.2 Ownership

CONTENT-009 requires explicit ownership. Ownership transfer must define:

- previous owner;
- new owner;
- effective time;
- affected organization/MCN scope;
- monetization consequences;
- rights/license consequences;
- audit record;
- pending review/schedule behavior.

No content may silently become ownerless.

## 5. Revision and collaboration

CONTENT-002/003/004 require:

- deterministic revision identity;
- optimistic concurrency/conflict behavior;
- autosave isolation from publish state;
- ability to identify the revision actually published;
- collaborator permission boundaries;
- recovery from failed saves;
- auditability of privileged edits.

Publishing a revision must not mutate historical revision records.

## 6. Moderation and policy gate

Before public distribution, content that requires review must pass the applicable moderation gate:

`submit → automated checks → human review when required → approve/reject/request changes → publish eligibility`

Applicable domains include:

- SAFETY-001 content moderation;
- SAFETY-002 media moderation;
- RIGHTS-002..007 copyright controls;
- GOV-001..009 reports/policy;
- SAFETY-013 age/child safety;
- ADS-010 ad safety for monetized placements.

Rejection must preserve reason/evidence and provide an appeal or resubmission path where policy permits.

## 7. Scheduling and publication

CONTENT-006/007 must define:

- scheduled publication timestamp and timezone semantics;
- cancellation/reschedule;
- publication idempotency;
- author/editor authorization;
- publication audit;
- cache invalidation;
- search/index update;
- feed eligibility update;
- recommendation eligibility update;
- notification trigger;
- SEO publication state;
- analytics event generation.

A content item is not considered published merely because a database status changed; all authoritative downstream eligibility events must be generated or reconciled.

## 8. Distribution eligibility

After publication, eligibility must be evaluated independently for:

- public page;
- authenticated audience;
- followers feed;
- For You feed;
- latest feed;
- trending/topic/category feed;
- search;
- recommendation;
- creator page;
- notifications;
- external/social preview;
- SEO/indexing;
- paid audience;
- regional audience;
- age-restricted audience.

FEED, REC, SEARCH, SEO, privacy, regional policy, moderation, and entitlement state must all be respected.

## 9. Paywall and monetization lifecycle

For MON-007..012:

`eligible content → access policy → free/paid boundary → product/plan → entitlement check → content delivery → purchase/subscription event → analytics`

### 9.1 Partial article paywall

The content model must support an explicit protected boundary. The platform may expose a free portion and require an active entitlement for the protected portion.

The API must not return protected content merely because the client requested the full document. Authorization and entitlement evaluation occur server-side.

### 9.2 Video/series access

Access may be attached to an individual video, series, membership, bundle, or purchase. Entitlement resolution must be authoritative and auditable.

## 10. Media lifecycle

MEDIA-001..015 and STORAGE-001..008 require:

`registered → upload pending → uploading → uploaded → validating → processing → ready → published/attached → delivered → archived/deleted`

Failure states must include at least:

- validation failed;
- upload failed;
- processing failed;
- moderation failed;
- rights blocked;
- deletion pending.

Derived resources such as thumbnails, posters, transcoded variants, subtitles, transcripts, fingerprints, and CDN references must have ownership and cleanup rules.

## 11. Live lifecycle

MEDIA-011/012 must cover:

`schedule → preparation → stream starting → live → degraded/recovering → ended → replay processing → replay ready → replay published/unpublished → archived/deleted`

Required controls:

- stream authorization;
- stream-key/security boundary;
- audience visibility;
- moderation during live;
- abuse/risk controls;
- stream health telemetry;
- viewer/engagement analytics;
- monetization where enabled;
- replay ownership and rights;
- automatic cleanup/retention.

## 12. Interaction lifecycle

Published content participates in:

- SOCIAL-003 likes/reactions;
- SOCIAL-004 comments/replies;
- SOCIAL-005 bookmarks;
- SOCIAL-006 shares/reposts/quotes;
- SOCIAL-007 mentions/hashtags;
- SOCIAL-008 polls/votes;
- SOCIAL-009 block/mute/hide;
- NOTIFY-001..008;
- ANALYTICS-002/011.

Interaction visibility must follow the content's current state. Unpublished/deleted/restricted content must not remain incorrectly discoverable through interaction APIs or caches.

## 13. Update and unpublish

An update must define whether it:

- creates a new revision;
- requires re-review;
- changes paywall boundaries;
- changes canonical/slug;
- changes translations;
- invalidates recommendation/search results;
- invalidates CDN/cache;
- emits subscriber/follower notifications;
- changes rights/licensing metadata.

Unpublish must remove the content from all applicable public discovery surfaces while preserving authorized historical records.

## 14. Archive and restore

Archive is distinct from delete.

Archive must define:

- who can archive;
- whether public access stops;
- whether purchases remain accessible;
- whether creator analytics remain visible;
- whether SEO is removed or redirected;
- storage lifecycle;
- retention duration;
- restore authorization.

Restore must re-evaluate moderation, rights, visibility, entitlement, and distribution eligibility rather than blindly restoring the former public state.

## 15. Deletion and dependent-resource cleanup

Deletion must coordinate:

- content record;
- revisions;
- media objects;
- derived media;
- CDN references;
- search index;
- feed candidates/cache;
- recommendation features;
- comments/interactions according to policy;
- bookmarks;
- notifications;
- analytics/PII;
- SEO URLs/redirects;
- rights/claims;
- orders/entitlements where legally/business-required;
- creator revenue/settlement evidence;
- backups/archives;
- legal holds.

Deletion must be idempotent and retryable. A partial failure must produce an observable pending/degraded state rather than silently claiming completion.

## 16. Rights lifecycle

For content carrying rights information:

`ownership/license declared → fingerprint/duplicate checks → publication eligibility → claim/takedown → counter-notice/appeal → resolution → rights revenue/record retention`

A rights takedown may override ordinary discovery eligibility. Counter-notice must not automatically restore content without the required review decision.

## 17. Translation lifecycle

For I18N-003..005:

`source published/revised → translation requested → translation draft → review → published variant → source update → stale marker/retranslation → retire`

Translations are versioned derivatives, not silent overwrites of the source content.

## 18. Analytics and event closure

Major lifecycle transitions must generate canonical events for:

- creation;
- revision;
- review decision;
- schedule/publish;
- impression/open;
- watch/read completion;
- interaction;
- paywall exposure;
- purchase/entitlement;
- share;
- report;
- restriction;
- unpublish;
- archive/restore;
- deletion.

Events must carry correlation/trace identity where supported and be safe for retry/deduplication.

## 19. Cache, queue and reliability closure

Content operations that trigger asynchronous work must define:

- job identity/idempotency;
- retry/backoff;
- timeout;
- dead-letter behavior;
- reconciliation;
- cache invalidation;
- stale-content behavior;
- operator visibility.

Required domains include JOB-001..008 and REL-001..010.

## 20. Content-type acceptance matrix

| Capability | Article | Gallery | Short video | Long video | Audio | Live | Future types |
|---|---:|---:|---:|---:|---:|---:|---:|
| Draft/revision | ✓ | ✓ | ✓ | ✓ | ✓ | scheduled config | ✓ |
| Moderation | ✓ | ✓ | ✓ | ✓ | ✓ | live + replay | ✓ |
| Scheduling | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Public distribution | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Feed/recommendation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | policy dependent |
| Search/SEO | ✓ | ✓ | ✓ | ✓ | ✓ | replay | policy dependent |
| Paywall | ✓ | optional | ✓ | ✓ | ✓ | optional | ✓ |
| Rights/fingerprint | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Translation | ✓ | metadata/captions | captions | captions | transcript | captions | type dependent |
| Archive/restore | ✓ | ✓ | ✓ | ✓ | ✓ | replay | ✓ |
| Delete/retention | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## 21. No-orphan content rules

The following states are prohibited:

- published content without valid ownership policy;
- public content with unresolved mandatory moderation status;
- paid content without entitlement/product relationship;
- media attachment without storage lifecycle;
- searchable content that is prohibited from discovery;
- deleted content still served from a canonical public cache;
- archived content silently remaining eligible for new distribution;
- translation variant newer than source without version relation;
- live replay without rights/ownership resolution;
- revenue event without source content/product event.

## 22. Pass 05 acceptance criteria

Pass 05 is CLOSED when:

- every major content type has a defined lifecycle;
- creation, revision, collaboration, moderation, scheduling, publication, distribution, monetization, rights, update, unpublish, archive, restore, and deletion are covered;
- media processing and derived resources have failure and cleanup states;
- live and replay lifecycle is complete;
- paywall semantics include partial article protection;
- Feed/Search/Recommendation/SEO eligibility is state-aware;
- translation is versioned;
- analytics/events are tied to lifecycle transitions;
- async/cache/retry/reconciliation requirements are explicit;
- no content lifecycle requires an unregistered hidden Feature ID;
- Contract-First remains the gate before implementation.

## 23. Next closure pass

Pass 06 will map every Feature ID to **canonical API surface + Web/H5 + Android + iOS + Mini Program + Admin/Support**, identifying any capability that currently has a functional definition but no exposed operational surface.
