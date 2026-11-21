# LuckRead L5/L6 IP Graph / IP Economy Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 `IP Graph / IP Economy` 全部现有 L4，并与 64、65、67、68、71、160–176、179、180、196 建立执行、权益、商业与证据边界。

仅本文件列出的 L4 被视为 IP Graph / IP Economy scope-closed。

## 1. IP Identity / Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create IP | ip-create-01 | IP ID unique; canonical namespace applied |
| validate name policy | ip-name-policy-01 | naming policy/version enforced; invalid name rejected |
| assign type | ip-type-assign-01 | supported IP type accepted; policy recorded |
| update profile | ip-profile-update-01 | authorized versioned mutation; audit retained |
| transition IP status | ip-status-transition-01 | allowed state transition only; resulting state durable |
| resolve canonical IP | ip-canonical-resolve-01 | canonical reference deterministic; aliases do not create second authority |

## 2. IP Ownership / Control / Dispute

| L4 | L5 | L6 minimum claims |
|---|---|---|
| bind owner | ip-owner-bind-01 | ownership authority verified; canonical owner reference |
| bind organization controller | ip-org-controller-bind-01 | organization authority validated; scope explicit |
| bind rights holder | ip-rights-holder-bind-01 | rights authority reference validated |
| bind co-owner | ip-co-owner-bind-01 | ownership share/role constraints explicit |
| execute ownership transfer | ip-ownership-transfer-01 | transfer preconditions satisfied; history retained; idempotent |
| open ownership dispute | ip-ownership-dispute-01 | dispute case durable; competing claims preserved |
| freeze disputed mutation where required | ip-dispute-freeze-01 | protected mutations blocked under active dispute policy |

## 3. IP Structure / Universe / Works

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create universe | ip-universe-create-01 | universe ID unique; owner/scope valid |
| bind series | ip-series-bind-01 | series canonical reference valid; duplicate edge prevented |
| bind character | ip-character-bind-01 | character identity canonical; relation authorized |
| bind work | ip-work-bind-01 | work reference/version valid; provenance retained |
| bind episode | ip-episode-bind-01 | episode reference valid; parent series/work constraints enforced |
| bind derivative work | ip-derivative-bind-01 | source/provenance/rights reference retained |

## 4. IP Relations / Graph Edges

| L4 | L5 | L6 minimum claims |
|---|---|---|
| attach content to IP | ip-content-edge-01 | content/IP scope authorized; edge unique |
| attach creator control relation | ip-creator-control-edge-01 | creator authorization validated; role/version traceable |
| attach community support relation | ip-community-support-edge-01 | community relation permitted; scope bounded |
| attach product monetization relation | ip-product-monetization-edge-01 | product/IP relation authorized; commerce reference canonical |
| attach adaptation relation | ip-adaptation-edge-01 | adaptation rights/provenance retained |
| attach license authorization relation | ip-license-edge-01 | active license/territory/time validated |

## 5. IP Discovery / Projection

| L4 | L5 | L6 minimum claims |
|---|---|---|
| build IP profile projection | ip-profile-projection-01 | projection derived from canonical IP state |
| build IP content feed | ip-content-feed-01 | eligible content only; visibility/rights filters applied |
| calculate related-IP edges | ip-related-edge-01 | relation source/version traceable; duplicate edge collapse deterministic |
| traverse creator/IP graph | ip-creator-graph-query-01 | canonical IDs used; scope/privacy/rights enforced |
| calculate popularity signal | ip-popularity-01 | source/window/version explicit; derived only |
| calculate trend signal | ip-trend-01 | signal quality/risk controls applied; version traceable |

## 6. IP Economy / Licensing / Commercialization

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create license offer | ip-license-offer-create-01 | offer ID/version unique; scope/territory/window explicit |
| accept/license contract | ip-license-contract-accept-01 | authorized parties; terms/version durable |
| create commercial collaboration | ip-commercial-collab-create-01 | parties/scope/rights linked; duplicate contract prevented |
| bind merchandise relation | ip-merchandise-edge-01 | product/license linkage canonical |
| bind campaign relation | ip-campaign-edge-01 | campaign scope and IP authorization validated |
| attribute revenue to IP | ip-revenue-attribution-01 | attribution model/version traceable; ledger reference canonical |

## 7. IP Rights / Safety / Moderation Gates

| L4 | L5 | L6 minimum claims |
|---|---|---|
| validate IP rights state | ip-rights-state-validate-01 | current rights decision resolved before protected operation |
| validate territory | ip-territory-validate-01 | territory policy deterministic |
| validate rights window | ip-rights-window-validate-01 | time window valid and versioned |
| validate adaptation permission | ip-adaptation-permission-01 | derivative authorization current |
| validate monetization permission | ip-monetization-permission-01 | commercial use rights verified |
| create IP moderation case | ip-moderation-case-01 | case linked to IP/version/policy |
| appeal IP decision | ip-appeal-01 | exact decision/policy/version linked |

## 8. Async / Event / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue IP graph rebuild | ip-graph-rebuild-enqueue-01 | job identity unique; source version fixed |
| retry IP graph job | ip-graph-job-retry-01 | retry bounded/idempotent |
| dead-letter IP graph job | ip-graph-job-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay IP graph job | ip-graph-job-replay-01 | replay cannot create duplicate/contradictory edges |
| enqueue IP revenue attribution | ip-revenue-job-enqueue-01 | unique operation key; financial effect protected |
| retry IP revenue attribution | ip-revenue-job-retry-01 | retry cannot double-attribute revenue |
| reconcile IP projections | ip-projection-reconcile-01 | canonical state reapplied; stale/deleted relations repaired |

## 9. Canonical Identity / Authority Boundary

- IP identity, ownership, control and rights-relevant facts have one authoritative business source.
- IP Graph edges are canonical relationships; projections, feeds, popularity and trend signals remain derived.
- Content, Creator, Community, Commerce and Rights domains MUST reference canonical IP identity rather than creating duplicate IP authority.
- Ownership transfer and disputes preserve historical claims and must not silently overwrite prior authority.
- Revenue attribution references the canonical ledger/settlement boundary and cannot become an independent financial authority.

## 10. Cross-Cutting Inheritance

```text
160 Lifecycle / retention / erasure
161 Backup / DR / BCP
162 Schema / migration / backfill
163 Event delivery / ordering / replay / DLQ
164 Saga / compensation where ownership/licensing/commerce cross domains
165 Unified async operation
166 Error / state taxonomy
167 Cache / invalidation / hot-key / stampede
168 Scope / tenant / organization isolation
169 Security / secret / key lifecycle / incident
170 Rate / quota / traffic shaping
171 Observability / SLI / SLO / error budget
172 Localization / region / time / currency
173 Accessibility for IP discovery and management surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 11. Readiness

```text
L4 scope = CLOSED
L5 coverage = CLOSED
L6 minimum claims = CLOSED
Contract refs = REQUIRED BEFORE READY
Test refs = REQUIRED BEFORE READY
Evidence = REQUIRED BEFORE PASS
Implementation = NOT AUTHORIZED
CL = NOT RUN
CI = NOT RUN
```

## 12. STOP

- duplicate IP authority created in Center/projection/cache;
- ownership transfer without verified preconditions/history;
- disputed ownership mutations bypass freeze policy;
- derivative/adaptation proceeds without rights/provenance;
- commercial use proceeds without license scope validation;
- IP revenue attribution creates financial authority outside ledger;
- graph rebuild resurrects deleted/restricted relations;
- replay creates duplicate ownership/licensing/commercial edges;
- popularity/trend signal becomes canonical IP state;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
