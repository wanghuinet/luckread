# LUCKREAD Blueprint Enhancement — Batch 03: Content / Media / Live v1.0

Status: **CLOSED / CONTRACT-FIRST READY**

## 1. Purpose

Close the content, media and live capability layer without creating parallel authorities. Existing Blueprint capabilities remain authoritative; this batch only adds missing maturity details and explicit contracts.

External-platform absorption confirms that mature creator platforms treat shows/series, seasons/episodes, playlists, podcasts, live streams/replays, analytics and creator-side publishing controls as connected content primitives rather than unrelated products. YouTube currently models a podcast as a show/playlist containing episodes, supports serial/non-serial shows with seasons/episodes, playlist analytics, and live replay/highlights. cite not embedded in repo: external research reference only.

## 2. Feature IDs

### Content lifecycle
- CONTENT-009 Content Studio unified authoring
- CONTENT-010 Draft autosave and recovery
- CONTENT-011 Revision/version history
- CONTENT-012 Scheduled publishing
- CONTENT-013 Preview/private/unlisted/limited visibility
- CONTENT-014 Content collaboration and approval
- CONTENT-015 Content reuse/citation/attribution
- CONTENT-016 Content archive/restore

### Entitlement / paywall
- CONTENT-017 Content entitlement gate
- CONTENT-018 Partial-content paywall
- CONTENT-019 Subscription/member-only content
- CONTENT-020 Preview/read/watch quota policy

### Structured content
- CONTENT-021 Series
- CONTENT-022 Season
- CONTENT-023 Episode
- CONTENT-024 Playlist/Collection
- CONTENT-025 Podcast show
- CONTENT-026 Podcast episode
- CONTENT-027 Community Post

### Media
- MEDIA-009 Upload session/resumable upload
- MEDIA-010 Media processing state
- MEDIA-011 Transcoding/variants
- MEDIA-012 Thumbnail/poster/cover variants
- MEDIA-013 Subtitle/caption
- MEDIA-014 Transcript
- MEDIA-015 Media metadata extraction
- MEDIA-016 Media moderation/risk status
- MEDIA-017 Media replacement/versioning

### Live
- LIVE-001 Live channel/session
- LIVE-002 Scheduled live
- LIVE-003 Live rehearsal/practice
- LIVE-004 Live chat/reaction
- LIVE-005 Live moderation
- LIVE-006 Live replay/highlight
- LIVE-007 Live performance analytics
- LIVE-008 Live monetization hooks

## 3. Canonical content model

All client surfaces use the same canonical content authority:

`Content → Content Version → Publication → Visibility → Entitlement → Distribution → Analytics → Audit`

Client-specific UI must not create separate business semantics for Web, Android, iOS or Mini App.

## 4. Content state machine

`DRAFT → REVIEW → SCHEDULED → PUBLISHED → UPDATED → ARCHIVED`

Exceptional states:
`REJECTED`, `SUSPENDED`, `REMOVED`.

A revision does not silently mutate an already published version. Published versions remain addressable for audit and rollback according to retention policy.

## 5. Visibility

Supported visibility semantics:

- PUBLIC
- FOLLOWERS_ONLY
- MEMBERS_ONLY
- SUBSCRIBERS_ONLY
- PRIVATE
- UNLISTED
- REGION_RESTRICTED
- AGE_RESTRICTED
- SCHEDULED

Visibility is distinct from entitlement. A public page may expose a free preview while the full resource is entitlement-gated.

## 6. Partial-content paywall

The requested model is formally supported:

`Content → Free Preview Boundary → Entitlement Gate → Protected Content`

Example:

`article.body[0..N] = public preview`
`article.body[N+1..end] = subscription entitlement required`

The boundary must be represented as structured content policy, not hard-coded frontend string slicing.

Minimum policy fields:

- entitlement type
- required plan/tier
- preview boundary type
- preview boundary value
- fallback teaser
- access-denied reason
- purchase/subscribe action

The API must return only the authorized representation. Clients must not receive protected content and hide it with CSS/JavaScript.

## 7. Series / season / episode

Structured media hierarchy:

`Series/Show → Season → Episode → Media Asset`

A series can be serial or non-serial. Episode ordering is explicit and stable. Moving an episode updates ordering metadata without changing the episode identity.

This mirrors mature platform behavior where shows can contain seasons and episodes and can be discoverable as a unit. cite not embedded in repo: external research reference only.

## 8. Podcast

Podcast is a structured content specialization, not a separate publishing system:

`Podcast Show → Season → Episode → Media`

Required capabilities:

- show metadata
- square cover
- visibility
- episode ordering
- season support
- audio/video representation
- transcript/subtitle
- podcast analytics
- search/discovery eligibility
- copyright eligibility

Current mainstream implementation validates the playlist/show + episode pattern and provides dedicated discovery and analytics. cite not embedded in repo: external research reference only.

## 9. Media pipeline

Canonical lifecycle:

`CREATED → UPLOADING → UPLOADED → PROCESSING → READY`

Exceptional:
`FAILED`, `QUARANTINED`, `REJECTED`, `DELETED_PENDING_RETENTION`.

A media asset can have multiple derived variants:

- original
- playback
- thumbnail
- poster
- preview
- subtitle
- transcript
- adaptive bitrate variants

Processing is asynchronous. Publication must depend on required media readiness rather than assuming upload completion equals playable media.

## 10. Live lifecycle

`DRAFT → SCHEDULED → REHEARSAL → LIVE → ENDED → REPLAY_PROCESSING → REPLAY_READY → ARCHIVED`

Live supports:

- scheduled session
- rehearsal/practice mode
- audience access policy
- chat
- reactions
- moderation
- replay/highlights
- live analytics
- monetization integration

Live revenue must use the canonical PAY / ledger / settlement authority; LIVE does not own money state.

## 11. Analytics events

Minimum canonical events:

- content_created
- content_updated
- content_published
- content_viewed
- preview_viewed
- entitlement_denied
- entitlement_granted
- media_uploaded
- media_processing_completed
- media_play_started
- media_play_completed
- live_scheduled
- live_started
- live_joined
- live_message_sent
- live_reaction
- live_ended
- replay_viewed

Events feed the existing Analytics authority and must not create per-feature analytics databases.

## 12. Permission / ownership

Reuse the existing 1.0 allocation:

- content ownership
- organization scope
- creator role
- attribution
- rights holder / licensor
- audit

Content collaboration must use scoped authorization and explicit ownership/attribution; being an editor or contributor does not silently transfer ownership.

## 13. Safety / rights gates

Before publication or distribution, content/media may require:

`rights_check → moderation_check → policy_check → entitlement_check → publish`

Copyright claim/counterclaim/review/appeal belongs to the global Rights/Governance authority, not to Media or Content as a duplicate system.

## 14. Contract invariants

1. Protected content is never returned to an unauthorized client.
2. Visibility and entitlement are separate concepts.
3. Published content has immutable-addressable version identity.
4. Media processing is asynchronous and observable.
5. Live replay is a derived content representation, not a second content authority.
6. Podcast/series/playlist are structured content relationships, not parallel publishing engines.
7. Money always routes through PAY / ledger / settlement.
8. Rights always route through RIGHTS / GOV.
9. Analytics always routes through the canonical Analytics authority.
10. All clients consume the canonical API contract.

## 15. Implementation boundary

This batch is **contract closure only**. Implementation proceeds only after the corresponding API/data/event contracts are frozen.

No Payload Core fork. No parallel entitlement engine. No parallel payment engine. No parallel rights engine. No client-specific business authority.

## 16. Exit criteria

Batch 03 is considered closed when every Feature ID above has:

`owner + contract + permission + state machine + data ownership + API/event boundary + async requirement + analytics + safety/rights requirement`

Then proceed to Batch 04: Search / Recommendation / Discovery.
