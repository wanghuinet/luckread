# LUCKREAD Blueprint Enhancement — Batch 04

## Status
CLOSED / CONTRACT-FIRST READY

## Scope
Search, discovery, recommendation and ranking are unified as platform capabilities. This batch does not introduce a second search authority or a second recommendation authority.

## Feature IDs
- SEARCH-001 Global search entry and query contract
- SEARCH-002 Query suggestions and autocomplete
- SEARCH-003 Search history and user controls
- SEARCH-004 Hot/trending searches
- SEARCH-005 Query correction and synonym handling
- SEARCH-006 Author/content/tag/topic/IP/media/podcast search
- SEARCH-007 Search filters, facets and sorting
- SEARCH-008 Search ranking and quality signals
- SEARCH-009 Search governance, suppression and safety
- SEARCH-010 Search analytics and feedback
- DISCOVERY-001 Discovery feed contract
- DISCOVERY-002 Candidate recall
- DISCOVERY-003 Eligibility and safety filtering
- DISCOVERY-004 Ranking
- DISCOVERY-005 Diversification and freshness
- DISCOVERY-006 Cold-start discovery
- DISCOVERY-007 Negative feedback and user controls
- DISCOVERY-008 Exploration/exploitation policy
- DISCOVERY-009 Author/content quality signals
- DISCOVERY-010 Recommendation explanation/trace metadata
- DISCOVERY-011 Experiment and policy assignment
- DISCOVERY-012 Recommendation analytics and feedback loop

## Search contract
Search request resolves through:
`query -> normalization -> suggestion/correction -> candidate retrieval -> eligibility -> ranking -> facets/sort -> response -> feedback`

Supported targets include content, creator, organization, tag, topic, IP, video, live replay, podcast, series and episode.

Search must respect visibility, entitlement, region, moderation, deletion, rights and account state before result exposure. Paid/entitled content must not leak protected body data through search snippets.

## Recommendation contract
Recommendation is a pipeline, not a single score:
`candidate recall -> eligibility/safety -> feature assembly -> ranking -> diversification -> freshness -> feed assembly -> delivery -> feedback -> experiment`

Candidate sources may include follows, subscriptions, interests, content similarity, creator similarity, trending content, fresh content, geographic/locale signals, collaborative signals and editorial/business rules.

Ranking must support configurable quality, relevance, freshness, popularity, diversity, creator quality, user affinity, negative feedback, safety and anti-fraud signals.

## Cold start
New users and new creators/content use deterministic fallback policies before sufficient behavioral data exists. Cold-start policy must not require an ML model to be available.

## Feedback
Supported feedback includes impression, click/open, dwell/watch/read completion, like, follow, subscribe, share, save, hide/not-interested, report, unsubscribe and conversion. Feedback is an event input to analytics and future ranking policy; it is not itself a permission grant.

## Experimentation
Ranking and discovery policies must support experiment assignment, cohort isolation, versioning, exposure logging and outcome measurement. Experiment configuration cannot bypass safety, entitlement or authorization invariants.

## Governance invariants
1. Search and recommendation never bypass AuthZ, Content Visibility, Rights, Safety or Entitlement.
2. Search snippets and recommendation cards must not disclose protected content beyond the allowed preview contract.
3. Anti-fraud signals cannot be treated as proof of genuine engagement without the defined quality policy.
4. Ranking policy is versioned and observable.
5. Recommendation does not own creator, content, payment, rights or moderation truth.
6. Search index is a derived representation; canonical data remains in its owning domain.
7. No mandatory external search vendor is part of the core contract; adapters may be added later.
8. No mandatory AI/ML model is required for the first production implementation; deterministic rules are a valid baseline.

## Reuse from 1.0
Reuse mature permission, ownership, organization scope, resource scope, audit, rights and settlement semantics. Do not copy legacy database tables, API paths or obsolete Payload implementation.

## Acceptance
Batch 04 is considered closed when every implementation item references one of the Feature IDs above and has a contract owner. Implementation proceeds only after Contract-First review and then tests/CI/GitHub evidence.

## Next
Batch 05 — Monetization / Commerce / Revenue, using the unified chain:
`Product -> Order -> Transaction -> Entitlement -> Revenue Split -> Ledger -> Settlement -> Audit`.
