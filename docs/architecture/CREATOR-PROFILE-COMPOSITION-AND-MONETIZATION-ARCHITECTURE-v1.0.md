# LuckRead Creator Profile Composition & Monetization Architecture v1.0

Baseline: main at d0d1236529acf78a6e6ce9bd5881bd2c7be5fb09.

Purpose: build a reusable architecture for 2.0 paid subscriptions, micro-drama, movies, serialized web novels, audio, photography/COS, comics and other content products without adding fixed Workers/D1 or modifying Payload Core.

## 1. Core decision

LuckRead must not model “one user = one creator type = one page”.

Use six layers:

Account / Identity
→ Creator Identity + Capabilities
→ Public Profile Surface
→ Profile Modules
→ Authoritative Content / Membership / Commerce Domains
→ Cache / Projection / Analytics

Identity answers who the user is.

Creator System answers which creator capabilities the user has.

Public Profile answers what the creator chooses to present.

Profile Modules are presentation/orchestration objects only.

Content, Membership, Commerce, Wallet/Ledger remain their own authorities.

Cache, projection and analytics remain derived data.

A single creator may therefore be a photographer, COS creator, comic creator, novel creator, video creator and membership seller at the same time without creating multiple accounts or multiple Creator authorities.

## 2. Capabilities + Modules

The existing Creator System Contract already separates creator type, profile, capabilities, qualification and membership eligibility.

Therefore:

creatorType = classification
creator capability = business capability
profile module = presentation

Module visibility must be driven by capability + product availability, not by a mutually exclusive creator type.

Examples:

| Capability | Profile module |
| --- | --- |
| Article / Novel | Web novel, serial, column |
| Image / Photography | Photography, COS gallery, portfolio |
| Video | Short video, video collection |
| Audio | Podcast, audio works |
| Comic | Comic, comic series |
| Drama / Series | Micro-drama, series |
| Membership | Membership, exclusive space |
| Collection | Collection, playlist |
| Community | Posts, community |

## 3. Public Profile Surface

Keep a stable page skeleton:

Hero / identity
→ Follow / Share / Subscribe
→ Membership
→ Featured works
→ Creator-selected modules
→ External links

The current public profile page already has Hero, Follow, Share, Membership-2.0 placeholder, Drama-2.0 placeholder and content tabs. The next evolution is to replace hard-coded future placeholders with a capability-aware Module Registry.

The profile remains one public URL and one Creator identity.

## 4. Module Registry

Initial module catalog:

identity
membership
featured
article-series
column
short-video
video
movie
audio
podcast
image-gallery
photography
cos
comic
drama
collection
playlist
post
community
external-links

A module should carry only presentation metadata such as:

moduleId
moduleType
title
displayMode
visibility
sortOrder
sourceRef
accessPolicyRef

sourceRef points to the owning domain.

accessPolicyRef may point to Membership / Entitlement.

The module must never become a second Content, Subscription, Entitlement or Payment authority.

## 5. Paid profile model

A paid creator profile is not only a subscription button.

The target chain is:

Creator
→ Membership Offering
→ Plan / Tier
→ Subscription
→ Entitlement
→ Protected Content

This allows the same creator page to show:

Free content
Membership tiers
Subscriber-only articles
Subscriber-only images
Subscriber-only audio
Subscriber-only comics
Subscriber-only episodes
Subscriber-only videos

Future commerce paths such as gift membership or other paid products can consume the same entitlement boundary instead of creating parallel access logic.

## 6. Reference product mechanisms

The design borrows mechanisms, not brand visuals or proprietary implementation.

OnlyFans-style creator pages demonstrate the useful pattern of creator identity, external social links and a clear subscription CTA. (mechanism reference: public profile + social links + subscription CTA)

PineDrama currently combines vertical short dramas with discovery, follows, comments and watchlists, showing how content discovery and creator relationship can coexist in one consumption loop. (mechanism reference: vertical short drama + discovery + follow + comments + watchlist)

NetShort currently uses a mixture of free-start content, coins and VIP/subscription access, with VIP benefits including ad-free viewing, supported offline downloads and selected episode access. (mechanism reference: free-start + coins/VIP + offline/ad-free/exclusive access)

DramaBox currently exposes membership purchases alongside other paid offers and combines them with recommendations and saved content flows. (mechanism reference: membership + paid offers + recommendations/saved content)

LuckRead should therefore support a unified loop:

Discovery
→ Preview
→ Follow
→ Subscribe
→ Entitlement
→ Protected Content
→ Renewal / Cancel
→ Creator Revenue

## 7. Multi-specialty examples

Photographer + COS + Comic:

Hero
→ Membership
→ Photography
→ COS Gallery
→ Comic Series
→ Member-only Gallery
→ Posts
→ External Links

Novel creator + Audio:

Hero
→ Membership
→ Serialized Novel
→ Column
→ Audio Chapters
→ Early-access Member Content
→ Posts

Video creator + Micro-drama:

Hero
→ Membership
→ Short Video
→ Movie / Long Video
→ Micro-drama
→ Exclusive Behind-the-scenes
→ Live entry

The identity remains one Creator.

## 8. Membership and paywall separation

Membership owns:

Plan
Subscription
Entitlement
Membership access state

Commerce / Payment owns:

Order
Payment provider result
Refund
Chargeback
Settlement input

Wallet / Ledger owns:

Money facts
Revenue
Payout / settlement facts

Content owns:

Article
Series
Video
Audio
Comic
Drama
Image
Collection

The public profile only composes references to these authorities.

Client-provided price, entitlement, revenue split or payment state is never authoritative.

## 9. Performance boundary

A public profile must not fan out into a full scan of every downstream domain.

Target:

Cached Profile Manifest
→ only visible modules
→ bounded module reads
→ cached hot data where appropriate

Do not implement:

Profile request
→ scan all articles
→ scan all media
→ scan all subscriptions
→ scan all entitlements
→ scan all analytics

Membership hot entitlement checks should use cache with safe fallback to authoritative state, consistent with the existing Membership Contract.

## 10. Fixed infrastructure remains unchanged

This architecture does not add a profile Worker or profile D1.

Existing ownership remains:

W01 — User/public shell
W02 — Identity / Account / Access
W03 — Content / Publish
W04 — Feed / derived projection
W05 — Transaction / commerce boundary
W07 — Membership / Subscription
W08 — Creator

No new D1 is required for the architectural model.

## 11. Development sequence

Paid subscription should be implemented in this order:

1. Membership Plan / Creator Offering
2. Subscription creation
3. Subscription state machine + authoritative version/CAS
4. Entitlement grant/revoke
5. Protected content / paywall
6. Creator public membership surface
7. Renewal / cancel / pause / resume
8. Commerce / payment integration
9. Creator revenue / settlement
10. Analytics / retention

Profile composition should evolve in this order:

1. Fixed Hero
2. Capability-aware Module Registry
3. Featured module
4. Membership module
5. Article / Novel module
6. Media modules
7. Comic / Drama modules
8. Collection / Playlist modules
9. Creator-configurable ordering / visibility
10. Cached profile manifest

Persistent creator-controlled layout is the only step that requires a new presentation-state contract. Before that contract is admitted, use server-defined defaults and do not invent a free-form JSON database field.

## 12. Architectural result

The final model is:

One Account
→ One Creator Identity
→ Many Capabilities
→ One Public Profile Surface
→ Many Profile Modules
→ Many Content / Commerce Products
→ One coherent Membership / Entitlement / Revenue chain

This lets LuckRead grow from article + video into a mainstream creator platform where photography, COS, comics, novels, audio, movies, micro-drama, subscriptions and future paid products can coexist on one creator page without duplicating authority or expanding the fixed 12-Worker / 4-D1 architecture.
