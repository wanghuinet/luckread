# LuckRead L5/L6 Content / Production / Graph Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Content、Content Graph 的现有 L4，并纳入 178 已关闭的 Content Production 边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Content Identity / Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate content ID | content-id-generate-01 | ID unique/non-reused; canonical namespace applied |
| validate content type | content-type-validate-01 | allowed type accepted; unsupported type rejected |
| bind owner | content-owner-bind-01 | owner scope enforced; owner immutable unless transfer contract applies |
| bind creator | content-creator-bind-01 | creator relation authorized; duplicate binding prevented |
| bind IP | content-ip-bind-01 | IP relation authorized; canonical reference used |
| resolve canonical reference | content-canonical-ref-01 | canonical target stable; invalid target rejected |
| enter draft | content-enter-draft-01 | only eligible content enters draft; state transition deterministic |
| submit review | content-review-submit-01 | required fields validated; review operation identified |
| accept review | content-review-accept-01 | authorized review decision; policy version recorded |
| schedule publication | content-schedule-01 | future schedule valid; duplicate schedule handled idempotently |
| publish | content-publish-01 | publication occurs once; authoritative state updated before success; event only on success |
| hide | content-hide-01 | authorized hide; visible projection converges |
| restore | content-restore-01 | eligible hidden/archived content restored; authorization enforced |
| archive | content-archive-01 | retention/lifecycle rules applied; archived state queryable |
| delete | content-delete-01 | deletion request durable; 160 lifecycle propagated; final state verifiable |
| mark failed | content-failed-01 | failure state durable; retryability explicit; user-safe error available |
| reject illegal transition | content-transition-guard-01 | illegal transition denied; no partial mutation |

## 2. Content Body / Publishing Controls

| L4 | L5 | L6 minimum claims |
|---|---|---|
| validate title | content-title-validate-01 | length/format rules enforced; invalid title rejected |
| persist title | content-title-persist-01 | authorized write persists exact normalized value; version preserved |
| validate summary | content-summary-validate-01 | length/format rules enforced; invalid summary rejected |
| persist summary | content-summary-persist-01 | authorized write persists; version semantics correct |
| validate structured body | content-body-validate-01 | schema validated; unsafe/unsupported structure rejected |
| persist body reference | content-body-reference-01 | body/reference consistent; R2/media reference not treated as business authority |
| validate media references | content-media-ref-validate-01 | each media authorized and lifecycle-compatible; missing assets rejected |
| attach media | content-media-attach-01 | relation unique; ownership/scope enforced; attachment auditable |
| attach files | content-file-attach-01 | allowed file type; scope enforced; lifecycle linked |
| assign language | content-language-assign-01 | supported language accepted; locale semantics deterministic |
| persist metadata | content-metadata-persist-01 | schema valid; canonical IDs used; version updated |
| resolve visibility | content-visibility-01 | audience result deterministic; privacy policy applied |
| resolve audience | content-audience-01 | requested audience within actor scope; blocked targets excluded |
| resolve region | content-region-01 | regional availability policy applied; region version traceable |
| resolve age/safety policy | content-safety-policy-01 | current policy applied; prohibited audience rejected |
| validate schedule | content-schedule-validate-01 | timezone/DST semantics correct; invalid window rejected |
| validate expiration | content-expiration-validate-01 | expiration after publication constraints; current policy applied |
| generate canonical URL | content-canonical-url-01 | stable canonical reference; collision prevented |

## 3. Content Versioning / Organization / Operations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create version ID | content-version-id-01 | version unique; parent/version chain correct |
| persist version snapshot | content-version-snapshot-01 | snapshot immutable after creation; source content traceable |
| freeze published snapshot | content-published-freeze-01 | published version cannot be mutated in place |
| create preview snapshot | content-preview-snapshot-01 | preview tied to exact version; stale preview detectable |
| validate rollback | content-rollback-validate-01 | target eligible; rights/moderation constraints applied |
| execute rollback | content-rollback-01 | rollback produces valid resulting version/state; idempotent where applicable |
| calculate diff | content-version-diff-01 | diff deterministic; no hidden mutation |
| record version audit | content-version-audit-01 | actor/resource/version/time traceable |
| assign category | content-category-assign-01 | current taxonomy reference valid; authorization enforced |
| assign topic | content-topic-assign-01 | topic reference current; duplicate relation prevented |
| assign tag | content-tag-assign-01 | tag policy valid; duplicate relation safe |
| bind series | content-series-bind-01 | series exists and authorized; ordering constraints respected |
| bind playlist | content-playlist-bind-01 | playlist relation valid; duplicate edge prevented |
| bind channel | content-channel-bind-01 | channel permission valid; state synchronized |
| bind collection | content-collection-bind-01 | collection scope enforced; duplicate membership safe |
| calculate duplicate fingerprint | content-duplicate-fingerprint-01 | fingerprint deterministic; source/version included |
| create merge-review case | content-merge-review-01 | case durable; competing content references retained; no silent merge |
| archive content | content-archive-command-01 | lifecycle policy enforced; downstream projections converge |
| restore content | content-restore-command-01 | authorization and eligibility checked; derived state repaired |
| authorize export | content-export-authorize-01 | current scope evaluated; restricted data excluded |
| execute deletion | content-delete-execute-01 | deletion follows 160; references/tombstone propagation complete |

## 4. Content Graph — Structural / Derivative / Distribution

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create series-content edge | graph-series-content-01 | parent/child scope valid; edge unique |
| validate episode-series edge | graph-episode-series-01 | series membership valid; cycle/order constraints enforced |
| create playlist-content edge | graph-playlist-content-01 | authorized membership; duplicate edge prevented |
| create collection-content edge | graph-collection-content-01 | collection scope valid; duplicate edge prevented |
| create channel-content edge | graph-channel-content-01 | channel owner/scope valid; edge lifecycle linked |
| enforce edge uniqueness | graph-edge-unique-01 | identical edge cannot coexist; concurrent mutation safe |
| create remix edge | graph-remix-edge-01 | source authorization exists; provenance retained |
| create translation edge | graph-translation-edge-01 | source/version referenced; language variant valid |
| create adaptation edge | graph-adaptation-edge-01 | rights authorization referenced; derivative provenance retained |
| create excerpt edge | graph-excerpt-edge-01 | source range/reference valid; rights policy applied |
| create quote edge | graph-quote-edge-01 | source content reference canonical; permission/policy checked |
| create response edge | graph-response-edge-01 | target reference valid; visibility policy inherited |
| create reaction-content edge | graph-reaction-content-01 | source/target scope validated; relation cannot become business authority |
| validate source authorization | graph-source-auth-01 | unauthorized source use rejected; decision auditable |
| create repost edge | graph-repost-edge-01 | repost permission/canonical source enforced |
| create syndication edge | graph-syndication-edge-01 | syndication scope/territory enforced; provenance retained |
| authorize embed | graph-embed-auth-01 | target allows embed; privacy/rights constraints enforced |
| create cross-post edge | graph-cross-post-01 | destination scope valid; source identity preserved |
| resolve canonical source | graph-canonical-source-01 | canonical source deterministic; cycles rejected |

## 5. Graph Governance / Traversal

| L4 | L5 | L6 minimum claims |
|---|---|---|
| authorize relation creation | graph-relation-auth-01 | actor has relation permission; scope bounded |
| resolve relation visibility | graph-relation-visibility-01 | viewer scope and privacy applied; result reproducible |
| delete relation | graph-relation-delete-01 | authorized deletion removes edge; derived projections converge |
| prevent duplicate edge | graph-relation-duplicate-01 | duplicate request idempotent; one effective edge |
| audit relation mutation | graph-relation-audit-01 | actor/relation/time/policy traceable |
| resolve parent | graph-parent-query-01 | canonical parent returned; deleted parent semantics stable |
| resolve children | graph-children-query-01 | visibility/rights filters applied; bounded pagination |
| resolve related content | graph-related-query-01 | relevance source/version traceable; hidden content excluded |
| resolve source | graph-source-query-01 | canonical provenance chain returned; deleted source represented safely |
| resolve derivatives | graph-derivative-query-01 | derivative set respects rights/visibility; stable pagination |
| rebuild graph projection | graph-rebuild-01 | projection rebuilds from authoritative relations/events; deleted edges not resurrected |

## 6. Content Production Closure

178-defined Content Production areas map at minimum to:

```text
composition
→ autosave
→ preview
→ packaging
→ collaboration
→ quality checks
→ repurposing
```

Minimum L5/L6 anchors:

| L4 responsibility | L5 | L6 minimum claims |
|---|---|---|
| create production project | production-project-create-01 | project ID unique; creator/workspace scope enforced |
| persist production checkpoint | production-checkpoint-01 | checkpoint version monotonic; recovery reproducible |
| build production preview | production-preview-01 | preview tied to exact project/version; stale preview detectable |
| validate package | production-package-validate-01 | required components present; invalid package rejected |
| mutate collaboration membership | production-collaboration-01 | collaborator scope enforced; revoke converges |
| execute quality gate | production-quality-gate-01 | checks deterministic; blocking failures explicit |
| execute repurpose command | production-repurpose-01 | source/version/provenance retained; duplicate job safe |

## 7. Cross-Cutting Inheritance

```text
160 Lifecycle
161 DR/BCP
162 Migration
163 Event
164 Saga where cross-domain
165 Async for processing/export/preview/repurpose
166 Error / State
167 Cache / projection
168 Scope / Tenant
169 Security / Rights-sensitive operations
170 Rate / Quota
171 Observability
172 Localization
173 Accessibility for editors/public surfaces
174 Canonical ID
175 Configuration / Policy
176 Evidence
```

## 8. Readiness

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

## 9. STOP

- unauthorized publication;
- illegal state transition;
- published version mutated in place;
- derivative without provenance/rights reference;
- graph edge duplicates;
- deletion resurrects through graph rebuild;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
