# LuckRead L5/L6 Feed / Recommendation / Personalization / Trending Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Feed、Recommendation、Personalization、Trending 相关现有 L4，并与 12、55、62、69、71、160–176、179、180 建立执行、风险与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Feed Assembly / Delivery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve feed surface | feed-surface-resolve-01 | requested surface valid; scope and policy resolved deterministically |
| create feed request | feed-request-create-01 | request ID/cursor context valid; replay safe |
| resolve candidate sources | feed-candidate-source-01 | allowed candidate sources selected; source/version traceable |
| merge candidate streams | feed-candidate-merge-01 | ordering deterministic; duplicate items bounded |
| filter visibility | feed-visibility-filter-01 | privacy/block/moderation/rights filters enforced |
| filter policy violations | feed-policy-filter-01 | disallowed content excluded before delivery |
| rank feed items | feed-rank-01 | ranking policy/model version recorded; deterministic tie rules |
| diversify feed | feed-diversify-01 | configured diversity constraints enforced |
| apply freshness rules | feed-freshness-01 | freshness window explicit; stale source handling deterministic |
| apply frequency caps | feed-frequency-cap-01 | per-surface/user caps enforced |
| paginate feed | feed-page-01 | stable cursor semantics; no duplicate/skip beyond documented bounds |
| materialize feed response | feed-response-01 | response reflects eligible current state; no authority created |
| record feed impression | feed-impression-01 | impression event attributable; event quality/status explicit |
| handle empty feed | feed-empty-01 | fallback policy explicit; no unauthorized leakage |
| recover feed assembly failure | feed-recovery-01 | bounded fallback; user-visible degraded state explicit |

## 2. Recommendation Candidate Generation

| L4 | L5 | L6 minimum claims |
|---|---|---|
| build follow candidates | rec-follow-candidate-01 | source relations canonical; blocked/invalid targets excluded |
| build content candidates | rec-content-candidate-01 | eligible content only; source provenance retained |
| build creator candidates | rec-creator-candidate-01 | creator state/public eligibility validated |
| build topic candidates | rec-topic-candidate-01 | taxonomy/topic references current |
| build related-content candidates | rec-related-candidate-01 | relation/version source traceable |
| build trending candidates | rec-trending-candidate-01 | trending source and window explicit |
| apply candidate eligibility | rec-candidate-eligibility-01 | policy, safety, rights and audience constraints enforced |
| deduplicate candidates | rec-candidate-dedupe-01 | canonical entity identity used; duplicate collapse deterministic |
| enrich candidate features | rec-feature-enrich-01 | feature version/source traceable; stale feature policy explicit |
| score candidate | rec-candidate-score-01 | model/rule version recorded; score reproducible from inputs |

## 3. Recommendation Policy / Ranking

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve recommendation policy | rec-policy-resolve-01 | current policy version selected by scope/region/surface |
| resolve model version | rec-model-version-01 | approved model version selected; rollback target known |
| rank candidates | rec-rank-01 | ranking output reproducible for fixed inputs/version |
| apply business constraints | rec-business-constraint-01 | constraints do not bypass safety/privacy/rights gates |
| apply diversity constraint | rec-diversity-01 | creator/topic/entity concentration bounded by policy |
| apply exploration policy | rec-exploration-01 | exploration cohort/version traceable; eligibility explicit |
| apply fatigue suppression | rec-fatigue-01 | repeated exposure suppression deterministic |
| suppress seen content | rec-seen-suppression-01 | seen-state source/version explicit; stale state policy defined |
| enforce creator fairness rule | rec-creator-fairness-01 | configured fairness bounds measurable and auditable |
| publish ranking snapshot | rec-ranking-snapshot-01 | snapshot immutable/versioned; inputs traceable |

## 4. Personalization / User State

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve user profile features | personalization-profile-01 | only authorized features used; feature freshness explicit |
| resolve interest profile | personalization-interest-01 | interest state versioned; source events traceable |
| update interest profile | personalization-interest-update-01 | update idempotent; invalid/raw events excluded by quality gate |
| resolve preference settings | personalization-preference-01 | user controls authoritative; policy precedence explicit |
| resolve locale preference | personalization-locale-01 | locale/region/time semantics deterministic |
| resolve interaction history | personalization-history-01 | history scope/privacy enforced; retention policy applied |
| build user embedding/profile | personalization-profile-build-01 | generation versioned; source data provenance retained |
| invalidate stale personalization | personalization-invalidate-01 | stale state detected; fallback behavior deterministic |
| freeze personalization snapshot | personalization-snapshot-01 | snapshot tied to version/time; no hidden mutation |
| erase personalization data | personalization-erasure-01 | lifecycle/erasure policy applied; derived copies handled |

## 5. Trending / Hot Topics

| L4 | L5 | L6 minimum claims |
|---|---|---|
| ingest trending signal | trending-signal-ingest-01 | signal schema valid; source attributable |
| validate signal quality | trending-signal-quality-01 | bot/spam/duplicate/low-quality signals filtered |
| aggregate topic velocity | trending-velocity-01 | aggregation window/time semantics deterministic |
| calculate topic score | trending-score-01 | score formula/version traceable |
| detect trend | trending-detect-01 | threshold/window policy versioned |
| suppress manipulated trend | trending-abuse-suppress-01 | risk signals can block/reduce exposure |
| assign trend rank | trending-rank-01 | tie-break and ranking version explicit |
| publish trending snapshot | trending-snapshot-publish-01 | snapshot versioned; source window recorded |
| regionalize trending | trending-region-01 | region/language policy explicit |
| expire trend | trending-expire-01 | expiry deterministic; stale trend removed from delivery |
| rebuild trending projection | trending-rebuild-01 | rebuilt from authoritative event/state sources; no phantom trend resurrection |

## 6. Feedback / Learning Loop

| L4 | L5 | L6 minimum claims |
|---|---|---|
| capture recommendation feedback | rec-feedback-capture-01 | event attributable; quality/status explicit |
| classify positive signal | rec-positive-signal-01 | valid event classes only; policy version traceable |
| classify negative signal | rec-negative-signal-01 | hide/dislike/report semantics distinct and durable |
| apply feedback suppression | rec-feedback-suppress-01 | suppression scope/version deterministic |
| aggregate recommendation metrics | rec-metric-aggregate-01 | counters/metrics derived and rebuildable |
| update recommendation features | rec-feature-update-01 | update idempotent; source event/version preserved |
| quarantine suspect feedback | rec-feedback-quarantine-01 | suspicious data excluded from trusted training/serving path |
| replay learning events | rec-feedback-replay-01 | replay idempotent; historical semantics preserved |

## 7. Safety / Trust / Rights Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enforce content safety | rec-safety-filter-01 | current safety policy applied before ranking delivery |
| enforce rights eligibility | rec-rights-filter-01 | territory/time/license constraints applied |
| enforce privacy | rec-privacy-filter-01 | private/restricted entities never leak through recommendation |
| enforce blocked relationship | rec-block-filter-01 | blocked actors/content excluded consistently |
| enforce age policy | rec-age-filter-01 | audience age policy applied deterministically |
| enforce risk suppression | rec-risk-suppress-01 | risk/trust decision bounded by explicit policy |
| audit recommendation decision | rec-decision-audit-01 | candidate/model/policy/filter decisions traceable |
| explain recommendation reason | rec-explain-01 | explanation source is policy/feature/model traceable; no invented claims |

## 8. Cache / Async / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| cache ranking snapshot | rec-cache-ranking-01 | cache contains derived state only; version key canonical |
| invalidate ranking cache | rec-cache-invalidate-01 | affected surfaces invalidated on version/state change |
| protect recommendation hot key | rec-hot-key-protect-01 | stampede control bounded; degraded fallback explicit |
| enqueue feature update | rec-feature-job-enqueue-01 | job unique/schema valid |
| retry recommendation job | rec-job-retry-01 | retries bounded/idempotent; backoff deterministic |
| dead-letter recommendation job | rec-job-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay recommendation job | rec-job-replay-01 | replay cannot create contradictory authority |
| rebuild recommendation projection | rec-rebuild-01 | projection rebuilt from authoritative inputs/events; stale snapshots ignored |

## 9. Experiment / Model Governance Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve experiment assignment | rec-experiment-assign-01 | cohort assignment deterministic; exposure recorded |
| resolve feature flag | rec-flag-resolve-01 | 175 config/policy version applied |
| log model exposure | rec-model-exposure-01 | model/version/surface/cohort traceable |
| compare experiment outcome | rec-experiment-evaluate-01 | metric definition/version fixed; cohort boundaries preserved |
| rollback model | rec-model-rollback-01 | approved prior version available; fallback deterministic |
| freeze degraded ranking policy | rec-degraded-policy-01 | safe baseline ranking available when model unavailable |

## 10. Cross-Cutting Inheritance

```text
160 Lifecycle / retention / erasure
161 Backup / DR / BCP
162 Schema / migration / backfill
163 Event delivery / ordering / replay / DLQ
164 Saga / compensation where cross-domain
165 Unified async operation
166 Error / state taxonomy
167 Cache / invalidation / hot-key / stampede
168 Scope / tenant / organization isolation
169 Security / secret / key lifecycle / incident
170 Rate / quota / traffic shaping
171 Observability / SLI / SLO / error budget
172 Localization / region / time / currency
173 Accessibility for feed/recommendation controls and surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 11. Authority / Trust Boundary

- Recommendation output, feed ordering, trending score and personalization profile are derived decisions/projections and MUST NOT become the authoritative source of content/user/rights state.
- Raw behavioral events MUST pass event-quality and risk/trust controls before influencing trusted recommendation signals.
- Safety, privacy, rights, age and block filters are mandatory pre-delivery constraints; ranking cannot override them.
- Model/rule/config versions MUST be traceable for every externally observable recommendation decision.
- Cached ranking and personalization state MUST be rebuildable from authoritative inputs.

## 12. Readiness

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

## 13. STOP

- raw untrusted event directly changes trusted recommendation state;
- privacy/block/rights/safety/age filter bypass;
- model version cannot be identified for a served decision;
- stale personalization silently treated as current authority;
- duplicate feedback/replay changes effective state twice;
- trending manipulation can bypass risk controls;
- cache becomes recommendation/business authority;
- ranking writes mutate canonical content/user state;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
