# LuckRead L5/L6 Search / Discovery / Analytics / Growth Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Search、Discovery、Analytics、Experiment、Growth 相关现有 L4，并与 53、69、71、139、160–176、179、180 建立执行、数据、指标与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Search Query / Retrieval Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create search request | search-request-create-01 | request ID/cursor context valid; replay safe |
| validate query | search-query-validate-01 | length/type/safety rules enforced; invalid query rejected |
| normalize query | search-query-normalize-01 | normalization deterministic; original query traceable where policy permits |
| resolve search scope | search-scope-resolve-01 | user/org/region/visibility scope deterministic |
| execute lexical retrieval | search-lexical-retrieve-01 | indexed fields/version explicit; no unauthorized fields returned |
| execute semantic retrieval | search-semantic-retrieve-01 | model/index version traceable; scope enforced |
| merge retrieval results | search-retrieval-merge-01 | ordering deterministic; duplicate canonical entities collapsed |
| apply visibility filter | search-visibility-filter-01 | privacy/block/moderation/rights filters applied before delivery |
| rank search results | search-rank-01 | ranking policy/version traceable; deterministic tie rules |
| paginate search results | search-page-01 | stable cursor; bounded pagination; duplicate/skip semantics explicit |
| return search response | search-response-01 | response reflects eligible current state; no authority created |
| handle empty search | search-empty-01 | fallback behavior explicit; no restricted leakage |

## 2. Search Indexing / Freshness / Rebuild

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create index document | search-index-document-create-01 | canonical entity/version used; scope fields complete |
| update index document | search-index-document-update-01 | update idempotent; stale version cannot overwrite newer state |
| delete index document | search-index-document-delete-01 | deletion follows lifecycle/tombstone semantics |
| validate index document | search-index-document-validate-01 | schema/version valid; prohibited fields excluded |
| publish index version | search-index-version-publish-01 | version immutable; rollout/rollback target known |
| resolve index version | search-index-version-resolve-01 | approved version selected by scope/region |
| measure index freshness | search-index-freshness-01 | lag metric deterministic; threshold policy explicit |
| reconcile index drift | search-index-reconcile-01 | source/index mismatch detected; repair auditable |
| rebuild search index | search-index-rebuild-01 | rebuilt from authoritative sources; deleted entities not resurrected |
| backfill index | search-index-backfill-01 | checkpointed/idempotent; source snapshot/version fixed |

## 3. Discovery / Explore / Topic / Entity Surface

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve discovery surface | discovery-surface-resolve-01 | requested surface/version valid |
| resolve topic page | discovery-topic-page-01 | canonical topic/entity references used |
| resolve entity page | discovery-entity-page-01 | unified entity identity and visibility enforced |
| resolve related topics | discovery-related-topic-01 | relation source/version traceable |
| resolve related creators | discovery-related-creator-01 | eligibility/privacy/rights filters applied |
| resolve related content | discovery-related-content-01 | current content state and canonical references used |
| resolve popular content | discovery-popular-content-01 | popularity window/source version explicit |
| resolve trending surface | discovery-trending-surface-01 | current trending snapshot/policy applied |
| resolve recommendation bridge | discovery-rec-bridge-01 | recommendation candidate source and version traceable |
| paginate discovery | discovery-page-01 | stable cursor and scope semantics |
| rebuild discovery projection | discovery-rebuild-01 | projection rebuildable; stale/deleted state repaired |

## 4. Analytics Event Intake / Quality

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate analytics event ID | analytics-event-id-01 | unique event identity; canonical source reference |
| validate analytics event | analytics-event-validate-01 | schema/type/time/source validation enforced |
| classify event quality | analytics-event-quality-01 | trusted/untrusted/quarantined status deterministic |
| deduplicate analytics event | analytics-event-dedupe-01 | idempotency key canonical; duplicate does not double count |
| enrich analytics event | analytics-event-enrich-01 | enrichment source/version traceable |
| route analytics event | analytics-event-route-01 | dataset/pipeline scope selected deterministically |
| quarantine invalid event | analytics-event-quarantine-01 | excluded from trusted metrics; disposition auditable |
| replay analytics event | analytics-event-replay-01 | replay idempotent; historical semantics preserved |
| purge analytics event | analytics-event-purge-01 | lifecycle/retention policy enforced |

## 5. Metrics / Aggregation / Attribution

| L4 | L5 | L6 minimum claims |
|---|---|---|
| define metric | analytics-metric-define-01 | metric formula/version/owner fixed |
| define dimension | analytics-dimension-define-01 | allowed dimensions/scope explicit |
| aggregate event stream | analytics-aggregate-01 | window/time semantics deterministic |
| calculate creator metric | analytics-creator-metric-01 | source events/definitions traceable |
| calculate content metric | analytics-content-metric-01 | canonical content/version source fixed |
| calculate campaign metric | analytics-campaign-metric-01 | campaign attribution boundary explicit |
| calculate commerce metric | analytics-commerce-metric-01 | order/payment source authority preserved |
| calculate ad metric | analytics-ad-metric-01 | impression/click definitions/version fixed |
| calculate retention metric | analytics-retention-01 | cohort definition/version immutable for run |
| calculate funnel metric | analytics-funnel-01 | stage definitions and cohort scope explicit |
| attribute conversion | analytics-attribution-01 | attribution model/version traceable |
| reconcile metric | analytics-metric-reconcile-01 | source/aggregate discrepancy detected and auditable |

## 6. Experiment / Feature Evaluation

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create experiment | experiment-create-01 | experiment ID/version unique; owner/scope enforced |
| define cohort | experiment-cohort-01 | deterministic assignment rules; exclusions explicit |
| assign participant | experiment-assign-01 | stable assignment; re-entry semantics explicit |
| expose variant | experiment-exposure-01 | variant/version/surface traceable |
| enforce guardrail | experiment-guardrail-01 | safety/reliability limits evaluated before exposure/scale |
| collect outcome | experiment-outcome-01 | metric/event linkage canonical |
| compare variants | experiment-compare-01 | metric definition/cohort/version fixed |
| stop experiment | experiment-stop-01 | stop state authoritative; future exposure blocked |
| roll back variant | experiment-rollback-01 | approved fallback deterministic |
| archive experiment | experiment-archive-01 | historical results immutable/queryable |

## 7. Growth / Lifecycle / Creator Success

| L4 | L5 | L6 minimum claims |
|---|---|---|
| define growth goal | growth-goal-define-01 | objective/metric/version/owner fixed |
| identify activation event | growth-activation-01 | activation condition deterministic |
| calculate retention cohort | growth-retention-cohort-01 | cohort membership/version traceable |
| calculate creator growth | growth-creator-growth-01 | canonical creator metrics used; source definitions fixed |
| identify churn signal | growth-churn-signal-01 | signal quality/status explicit |
| run lifecycle campaign | growth-lifecycle-campaign-01 | audience/policy/version bounded |
| execute re-engagement | growth-reengagement-01 | eligibility/privacy/frequency rules enforced |
| calculate growth opportunity | growth-opportunity-01 | source metrics/model version traceable |
| evaluate creator success | growth-creator-success-01 | success definition/version fixed; derived output not authority |
| freeze growth snapshot | growth-snapshot-01 | snapshot immutable/versioned |

## 8. Dashboard / Reporting / Export

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve analytics dashboard | analytics-dashboard-resolve-01 | authorized scope and metric versions applied |
| render metric panel | analytics-panel-render-01 | displayed metric maps to defined source/version |
| generate report | analytics-report-generate-01 | source window/definition/version recorded |
| export analytics data | analytics-export-01 | scope/privacy/retention rules enforced |
| schedule report | analytics-report-schedule-01 | schedule/timezone/version deterministic |
| deliver report | analytics-report-deliver-01 | recipient scope validated; delivery attributable |
| revoke report access | analytics-report-revoke-01 | future access blocked; cached copies governed |
| rebuild dashboard projection | analytics-dashboard-rebuild-01 | derived state rebuildable from authoritative metrics |

## 9. Privacy / Security / Governance Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enforce analytics scope | analytics-scope-01 | tenant/user/org scope enforced |
| minimize sensitive analytics | analytics-minimization-01 | prohibited sensitive fields excluded |
| apply retention policy | analytics-retention-policy-01 | 160 policy/version enforced |
| enforce export authorization | analytics-export-auth-01 | actor/role/purpose/scope checked |
| audit analytics access | analytics-access-audit-01 | actor/resource/time/purpose traceable |
| protect experiment confidentiality | experiment-confidentiality-01 | restricted assignments/results not leaked |
| validate growth campaign policy | growth-policy-validate-01 | current policy/rights/privacy/frequency rules enforced |

## 10. Async / Cache / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue analytics pipeline | analytics-job-enqueue-01 | unique job/schema valid |
| retry analytics job | analytics-job-retry-01 | bounded/idempotent retry; backoff explicit |
| dead-letter analytics job | analytics-job-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay analytics pipeline | analytics-job-replay-01 | replay cannot double count trusted metrics |
| cache analytics result | analytics-cache-01 | cache contains derived state only; versioned key |
| invalidate analytics cache | analytics-cache-invalidate-01 | affected dashboards/reports invalidated |
| recover analytics pipeline | analytics-recover-01 | checkpoint/source version preserved |
| reconcile analytics projection | analytics-reconcile-01 | source/derived drift repaired audibly |

## 11. Cross-Cutting Inheritance

```text
160 Lifecycle / retention / erasure
161 Backup / DR / BCP
162 Schema / migration / backfill
163 Event delivery / ordering / replay / DLQ
164 Saga / compensation where analytics/growth crosses domains
165 Unified async operation
166 Error / state taxonomy
167 Cache / invalidation / hot-key / stampede
168 Scope / tenant / organization isolation
169 Security / secret / key lifecycle / incident
170 Rate / quota / traffic shaping
171 Observability / SLI / SLO / error budget
172 Localization / region / time / currency
173 Accessibility for search/discovery/analytics controls and surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 12. Authority / Data Boundary

- Search indexes, analytics datasets, dashboards, experiment outcomes and growth snapshots are derived or analytical state and MUST NOT replace domain authority.
- Search and discovery MUST use canonical entity references and apply privacy, moderation, rights and scope filters before delivery.
- Trusted analytics MUST be computed only from events that pass event quality, deduplication and applicable risk/privacy controls.
- Metric definitions, attribution models, experiment assignments and ranking/index versions MUST be traceable and versioned.
- Export/reporting access MUST respect lifecycle, privacy, security and role boundaries.
- Cached search/analytics/discovery state MUST be rebuildable from authoritative inputs.

## 13. Readiness

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

## 14. STOP

- unauthorized/private fields leak through search;
- index or analytics projection becomes business authority;
- raw/untrusted events directly become trusted metrics;
- duplicate/replay double-counts metrics;
- metric definition changes without version traceability;
- experiment assignment is non-deterministic without declared policy;
- growth campaign bypasses privacy/rights/frequency controls;
- export bypasses scope/authorization/retention rules;
- stale index resurrects deleted/restricted entities;
- cache becomes source of truth;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
