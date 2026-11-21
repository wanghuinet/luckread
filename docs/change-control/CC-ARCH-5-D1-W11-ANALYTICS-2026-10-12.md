# Change Control — Adopt Five-D1 Topology with W11 Analytics Domain — 2026-10-12

**Status:** PROPOSED FOR REVIEW / NOT MERGED
**Scope:** Canonical architecture and contract topology only
**Target:** 12 Workers / 5 D1 domains / 25 Contract Tasks

## 1. Decision requested

Replace the current canonical four-D1 topology with five D1 domains. The fifth domain, D1-05, is dedicated to analytics-derived data and is exclusively accessible by W11.

This is a deliberate architecture change, not an implicit exception. The existing four business domains retain their responsibilities and authority.

## 2. Canonical domain assignments

| D1 | Authority | Primary owner |
|---|---|---|
| D1-01 | Identity / Account / Access | W02; W08 for scoped creator/organization entities |
| D1-02 | Content / Community Data | W03; W05 for scoped social/community entities |
| D1-03 | Platform Operations / Governance / Runtime, including growth/campaign operational state | W06, W09, W10; W11 for scoped campaign/growth operations |
| D1-04 | Commerce / Financial Authority | W07 |
| D1-05 | Analytics-only derived data, aggregates and analytics processing state | W11 exclusively |

## 3. D1-05 permitted data

- Bounded validated analytics events where retention is necessary and admitted.
- Deduplication/idempotency keys with explicit retention.
- Article, dynamic and short-video view/play counters and time-window aggregates.
- Reading duration and video-completion aggregates where reliable events exist.
- Reconciled projections for likes, comments, shares, bookmarks and follower changes.
- Creator/content daily rollups, metric versions, watermarks and reconciliation status.
- Rebuildable creator/operations dashboard read models.

D1-05 must not become the authority for account identity, content publication, social relationships, entitlements, orders, payments, revenue, refunds or ledger facts. W03/W05/W07 remain authoritative for their domains. Core user writes must not wait for analytics persistence.

## 4. Topology and access invariants

1. Keep 12 Workers and 25 Contract Tasks unchanged.
2. Keep D1-01..D1-04 business ownership and schemas unchanged under this amendment.
3. W11 may access D1-03 only for its already-scoped campaign/growth operations and D1-05 for analytics-only data.
4. No other Worker receives D1-05 access.
5. No Worker, Queue, Service Binding, Payload Core change or new business authority is introduced.
6. Neon remains optional and is not required for the first D1-backed analytics release.
7. D1-05 must be treated as a projection/derived store and be rebuildable/reconcilable against authoritative domain facts.

## 5. Provisioning gates — not completed by this document

This change-control document and its PR do not create or bind a Cloudflare database. Before physical provisioning/binding, the repository must have:

- canonical Worker × D1 mapping and D1-05 owner contract reconciled;
- physical D1 registry entry and resource/access declaration updated with the actual database UUID;
- W11 Wrangler binding admitted without granting D1-05 to other Workers;
- schema/migration, indexes, retention/deletion, privacy/consent, deduplication, batch-write and rebuild/reconciliation contracts;
- CI guard and current-head evidence for topology, binding, authorization and runtime behavior;
- confirmation that all 1.1 feature IDs and event sources are already admitted.

Until these gates pass, D1-05 is a canonical target domain with no physical UUID/binding and must not be marked provisioned or GREEN.

## 6. Acceptance and status

- [ ] PR review and required CI gates pass.
- [ ] Canonical Blueprint, D1 Master, Mapping, Worker Master and access-boundary contract agree on 5 D1 domains.
- [ ] W11 is the sole allowed Worker for D1-05.
- [ ] D1-01..D1-04 authority remains unchanged.
- [ ] D1-05 physical UUID, schema, binding and runtime evidence are completed under separate admission gates before provisioning is claimed.
- [ ] Current gate status remains BLOCKED wherever its existing Mapping 0, contract-generation or global implementation gates remain open.

## 7. Rollout order

1. Merge the architecture/contract amendment after CI and review.
2. Register the D1-05 physical database only after provisioning admission.
3. Add the W11-only binding and schema/migrations.
4. Verify access-boundary and runtime evidence.
5. Implement event ingestion and aggregation only through already admitted event/API contracts.
6. Reconcile D1-05 aggregates to W03/W05/W07 authoritative facts before creator dashboards rely on them.
