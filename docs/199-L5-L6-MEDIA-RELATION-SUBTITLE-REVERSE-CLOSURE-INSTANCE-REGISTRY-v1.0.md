# LuckRead L5/L6 Media Relation / Subtitle Reverse Closure Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

本文件专门关闭 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Media 明确列出的跨域 relation L4 与 Subtitle Asset L4，并作为 187 的补充反向追踪证据。

本文件不创建新的产品能力；其作用是证明每个关系型/字幕型 L4 都存在明确 owning L5 与确定性 L6。

## 1. Media → Content Relations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| attach to content | media-rel-content-attach-01 | canonical media/content IDs; ownership/scope validated; relation unique |
| detach from content | media-rel-content-detach-01 | authorized removal; downstream projections converge |
| resolve content media | media-rel-content-query-01 | only eligible asset/version returned; visibility/rights applied |
| preserve content-media provenance | media-rel-content-provenance-01 | source asset/version traceable; no hidden replacement |

## 2. Media → Creator Relations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| attach to creator | media-rel-creator-attach-01 | creator scope authorized; canonical relation unique |
| detach from creator | media-rel-creator-detach-01 | authorized removal; derived surfaces repaired |
| resolve creator media | media-rel-creator-query-01 | creator authority/scope enforced; restricted assets excluded |
| preserve creator-media provenance | media-rel-creator-provenance-01 | asset/version/source lineage retained |

## 3. Media → IP Relations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| attach to IP | media-rel-ip-attach-01 | canonical IP reference; rights/scope validated |
| detach from IP | media-rel-ip-detach-01 | authorized removal; graph projections converge |
| resolve IP media | media-rel-ip-query-01 | eligible assets only; rights/territory policy applied |
| preserve IP-media provenance | media-rel-ip-provenance-01 | IP/source/version lineage deterministic |

## 4. Media → Message / Comment Relations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| attach to message | media-rel-message-attach-01 | participant/scope permission validated; relation unique |
| detach from message | media-rel-message-detach-01 | authorized removal; deleted/expired message policy followed |
| resolve message media | media-rel-message-query-01 | private scope enforced; deleted/quarantined assets excluded |
| attach to comment | media-rel-comment-attach-01 | comment target/version valid; moderation policy applied |
| detach from comment | media-rel-comment-detach-01 | authorized removal; projection converges |
| resolve comment media | media-rel-comment-query-01 | comment visibility/moderation/rights filters enforced |

## 5. Media → Product / Commerce Relations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| attach to product | media-rel-product-attach-01 | product/version owner scope valid; relation unique |
| detach from product | media-rel-product-detach-01 | authorized removal; catalog projections repaired |
| resolve product media | media-rel-product-query-01 | eligible product/version and media state verified |
| preserve commerce provenance | media-rel-commerce-provenance-01 | product/media version lineage traceable |

## 6. Subtitle Asset Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create subtitle asset | subtitle-asset-create-01 | subtitle asset ID unique; media/source scope bound |
| upload subtitle | subtitle-upload-01 | format/size/source authorization validated |
| import subtitle | subtitle-import-01 | supported syntax parsed; malformed input rejected |
| extract subtitle | subtitle-extract-01 | extraction tied to exact source/version |
| validate synchronization | subtitle-sync-validate-01 | timing/order constraints deterministic |
| create language variant | subtitle-language-variant-01 | supported locale; source/version relation retained |
| update subtitle | subtitle-update-01 | authorized versioned mutation; published snapshot immutable where required |
| mark subtitle ready | subtitle-ready-01 | integrity/format/sync checks complete before serving |
| mark subtitle failed | subtitle-failed-01 | failure durable; retryability explicit |
| quarantine subtitle | subtitle-quarantine-01 | unsafe subtitle excluded from serving; audit retained |
| archive subtitle | subtitle-archive-01 | lifecycle policy applied; archived state queryable |
| delete subtitle | subtitle-delete-01 | deletion follows lifecycle/erasure policy; references safe |
| attach subtitle to media | subtitle-media-attach-01 | media/source/version canonical; duplicate language binding prevented |
| detach subtitle from media | subtitle-media-detach-01 | authorized removal; playback projection converges |
| resolve subtitle for playback | subtitle-playback-resolve-01 | viewer locale/rights/age/safety constraints applied |

## 7. Media Relation Integrity / Graph Safety

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enforce relation uniqueness | media-relation-unique-01 | concurrent duplicate edge requests collapse to one effective relation |
| validate relation scope | media-relation-scope-01 | tenant/user/org boundaries enforced |
| validate relation lifecycle compatibility | media-relation-lifecycle-01 | source/target lifecycle states compatible |
| audit relation mutation | media-relation-audit-01 | actor/source/target/time/policy traceable |
| rebuild relation projection | media-relation-rebuild-01 | authoritative relations re-applied; deleted relations not resurrected |
| reconcile dangling media relation | media-relation-reconcile-01 | missing/deleted target detected; repair auditable |

## 8. Cross-Cutting Inheritance

```text
160 Lifecycle / retention / erasure
161 Backup / DR / BCP
162 Schema / migration / backfill
163 Event delivery / ordering / replay / DLQ
164 Saga / compensation where relation crosses domains
165 Unified async operation
166 Error / state taxonomy
167 Cache / invalidation / hot-key / stampede
168 Scope / tenant / organization isolation
169 Security / secret / key lifecycle / incident
170 Rate / quota / traffic shaping
171 Observability / SLI / SLO / error budget
172 Localization / region / time / currency
173 Accessibility for captions/subtitles and media relations where applicable
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 9. Authority Boundary

- Media relation records are authoritative only for their relation semantics; they do not replace Content, Creator, IP, Message, Comment or Product authorities.
- Subtitle state is an asset/media-processing concern; playback eligibility additionally depends on content, rights, privacy, region and safety policies.
- Relation projections, playback indexes and caches are derived and rebuildable.
- Cross-domain deletion must follow the authoritative lifecycle of each participating domain and must not resurrect relations during rebuild.

## 10. Readiness

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

## 11. STOP

- media relation created without canonical source/target IDs;
- relation bypasses scope/rights/moderation checks;
- duplicate relation creates multiple effective edges;
- subtitle served before ready/integrity state;
- subtitle language variant overwrites another without explicit policy;
- relation rebuild resurrects deleted media or targets;
- playback cache bypasses current rights/privacy/safety state;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
