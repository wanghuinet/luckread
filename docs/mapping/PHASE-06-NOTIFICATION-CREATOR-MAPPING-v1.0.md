# Phase 6 — Notification / Creator Platform Mapping v1.0

**Status:** MAPPING_BASELINE / NOT_GREEN_UNTIL_EVIDENCE

## Scope
### Notification
- Likes
- Comments/replies
- Follows
- Mentions
- System notifications
- Subscription notifications
- Read/unread state
- Notification preferences

### Creator
- Creator profile
- Content management
- Draft management
- Publishing entry points
- Creator statistics
- Content performance
- Audience/follower statistics

## End-to-end closure
`Domain event -> Notification eligibility -> Delivery record -> Read state`

`Creator -> Content management -> Publication -> Statistics -> Creator dashboard`

## Required mappings
N01 event sources; N02 notification types; N03 recipient resolution; N04 preference/filtering; N05 delivery state; N06 read state; N07 deduplication; N08 creator identity; N09 creator content ownership; N10 analytics aggregation; N11 dashboard API; N12 privacy/authorization.

## Invariants
- Notifications do not grant permissions.
- Notification generation is idempotent where duplicate events are possible.
- Creator statistics are derived from defined events and aggregation windows.
- Private creator/account data requires explicit authorization.

## Exit gate
Notification and creator workflows require executable contracts, integration/E2E coverage, failure/retry testing and evidence.
