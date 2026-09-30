# LuckRead L5/L6 Creator / Creator Studio / Organization-MCN Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

本实例包把 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Creator、Creator Studio、Organization / MCN 的现有 L4 展开为 L5 Execution Specification 与 L6 Verification Claims。

仅本文件列出的 L4 被视为 scope-closed；其他 L4 不得推定已完成实例化。

## 1. Instance contract

```text
L4 → L5 → L6 → contract refs → test refs → evidence
```

## 2. Creator Identity / Verification

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create creator ID | creator-create-01 | creator ID unique; owner binding required; duplicate create prevented |
| reserve creator handle | creator-handle-reserve-01 | reservation scoped; conflicting handle rejected; retry idempotent |
| enforce handle uniqueness | creator-handle-unique-01 | uniqueness enforced under concurrent requests; no duplicate active handle |
| update creator profile | creator-profile-update-01 | authorized mutation persists; version conflict detected; audit where required |
| assign creator category | creator-category-01 | allowed category only; authorization enforced; current value queryable |
| validate external creator link | creator-external-link-validate-01 | URL/schema validation deterministic; unsafe target rejected; normalized reference stored |
| remove external creator link | creator-external-link-remove-01 | owner/delegate authorization enforced; link removed; audit preserved |
| create verification application | creator-verification-apply-01 | eligible creator can apply; duplicate active application prevented; evidence reference required |
| attach verification evidence | creator-verification-evidence-01 | evidence bound to application; unauthorized attachment denied; sensitive data protected |
| admit verification queue item | creator-verification-queue-01 | only eligible application admitted; queue identity durable; duplicate admission prevented |
| assign reviewer | creator-verification-reviewer-01 | authorized reviewer assigned; assignment auditable; scope enforced |
| record reviewer decision | creator-verification-decision-01 | valid decision state persisted; reviewer authorization enforced; policy version recorded |
| set verification expiry | creator-verification-expiry-01 | expiry deterministic; expired status enforced; renewal path available |
| create reverification request | creator-reverification-01 | eligible creator can reverify; duplicate active request prevented; reason recorded |
| publish verification badge projection | creator-badge-projection-01 | badge derives from authoritative verification state; stale badge invalidated; rebuildable |

## 3. Creator Ownership / Status / Relations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| bind user to creator | creator-user-bind-01 | one authoritative binding; unauthorized bind denied; duplicate bind rejected |
| assign controller | creator-controller-01 | controller scope explicit; previous controller handled by policy; audit retained |
| grant delegated operator | creator-delegate-grant-01 | delegation bounded by scope/expiry; unauthorized grant denied; audit retained |
| revoke delegated operator | creator-delegate-revoke-01 | revoke takes effect; stale permission rejected; operation idempotent |
| create ownership transfer request | creator-transfer-request-01 | request durable; eligibility validated; duplicate transfer blocked |
| validate transfer prerequisites | creator-transfer-validate-01 | rights/scope blockers detected; decision reproducible; failure normalized |
| complete transfer | creator-transfer-complete-01 | authority changes atomically within domain boundary; audit and version updated |
| close creator | creator-close-01 | closure eligibility checked; authoritative state transitions; dependent access follows policy |
| activate creator | creator-activate-01 | only eligible creator activates; state transition valid; audit retained |
| restrict creator | creator-restrict-01 | policy decision required; restriction state visible; downstream enforcement emitted where required |
| suspend creator | creator-suspend-01 | authorized enforcement; suspension state authoritative; dependent actions constrained |
| reinstate creator | creator-reinstate-01 | only eligible creator reinstated; previous restrictions reconciled; audit retained |
| audit status transition | creator-status-audit-01 | every privileged status transition traceable to actor/policy/time |
| invite collaborator | creator-collab-invite-01 | invitation scoped; duplicate active invite handled; expiry assigned |
| accept collaboration | creator-collab-accept-01 | recipient authorization verified; relationship created once; acceptance auditable |
| assign co-author | creator-coauthor-01 | authorized assignment; duplicate relation prevented; scope visible |
| assign contributor | creator-contributor-01 | authorized role granted; scope bounded; revocation path available |
| assign editor | creator-editor-01 | edit permission limited to declared resources; unauthorized mutation denied |
| assign manager | creator-manager-01 | manager scope bounded; privileged actions auditable; transfer-safe |
| bind agency representation | creator-agency-bind-01 | representation authority explicit; contract/scope reference required |
| revoke relationship | creator-relation-revoke-01 | access removed; historical audit retained; derived permissions converge |

## 4. Creator Public Surface

| L4 | L5 | L6 minimum claims |
|---|---|---|
| return creator profile | creator-profile-read-01 | public/private fields follow visibility policy; canonical ID stable |
| paginate creator content | creator-content-list-01 | cursor stable; visibility/moderation filters applied; bounded page size |
| paginate creator IPs | creator-ip-list-01 | ownership/visibility policy applied; stable pagination |
| return follower summary | creator-follower-summary-01 | aggregate derived from authoritative graph; privacy policy respected |
| return derived creator statistics | creator-stats-read-01 | source/version visible internally; stale policy defined; rebuildable |
| return external links | creator-links-read-01 | only valid visible links returned; unsafe links suppressed |

## 5. Creator Studio Workspace / Creation

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create workspace | studio-workspace-create-01 | owner assigned; unique workspace ID; scope enforced |
| add member | studio-member-add-01 | invitation/authorization required; duplicate membership prevented |
| remove member | studio-member-remove-01 | authorized removal; active operations handled by policy; audit retained |
| assign workspace role | studio-role-assign-01 | role transition authorized; privilege cannot exceed owner scope |
| evaluate workspace permission | studio-permission-01 | deny-by-default; scope evaluated; decision reproducible |
| switch workspace | studio-workspace-switch-01 | only authorized memberships available; context changes safely |
| issue invitation | studio-invite-01 | invitation scoped/expiring; secret token protected; duplicate policy defined |
| revoke invitation | studio-invite-revoke-01 | revoked invitation rejected; operation idempotent; audit retained |
| create article draft | studio-article-draft-create-01 | valid creator/workspace required; draft owned correctly; duplicate retry safe |
| create post draft | studio-post-draft-create-01 | type-specific validation; ownership correct; duplicate retry safe |
| attach media | studio-media-attach-01 | asset authorized; relation unique; lifecycle state compatible |
| assign cover | studio-cover-assign-01 | valid media type; owner/scope enforced; current cover queryable |
| persist autosave checkpoint | studio-autosave-01 | checkpoint version monotonic; concurrent edits detected; recovery possible |
| generate preview | studio-preview-01 | preview references current version; async identity when needed; stale preview detectable |
| validate editor payload | studio-editor-validate-01 | schema valid; unsafe/unsupported structures rejected; normalized errors |
| recover latest checkpoint | studio-checkpoint-recover-01 | latest eligible checkpoint restored; unauthorized checkpoint inaccessible |

## 6. Publishing / Management / Versioning

| L4 | L5 | L6 minimum claims |
|---|---|---|
| validate publish command | studio-publish-validate-01 | ownership/scope/state/policy/version checks enforced; deterministic failure |
| publish immediately | studio-publish-now-01 | valid publication transitions state once; duplicate submission idempotent; publish event emitted only on success |
| schedule publication | studio-publish-schedule-01 | valid future time accepted; duplicate schedule safe; policy/version captured |
| query publication calendar | studio-publish-calendar-01 | only authorized workspace content returned; ordering deterministic |
| validate visibility | studio-visibility-validate-01 | allowed visibility only; policy/scope enforced |
| validate audience | studio-audience-validate-01 | audience policy valid; blocked/restricted targets rejected |
| validate category/topic | studio-taxonomy-validate-01 | taxonomy references current; invalid taxonomy rejected; canonical IDs used |
| record publish failure | studio-publish-failure-01 | failure state durable; user-safe error mapped; retry eligibility preserved |
| retry safe publication | studio-publish-retry-01 | only retryable state accepted; duplicate publish prevented; final outcome observable |
| query drafts | studio-drafts-read-01 | scope enforced; stable pagination; deleted/archived semantics clear |
| query published content | studio-published-read-01 | visibility enforced; published snapshot immutable |
| query archived content | studio-archived-read-01 | archived scope enforced; restoration reference available |
| validate bulk-edit scope | studio-bulk-scope-01 | requested items all authorized; partial scope cannot silently mutate unauthorized records |
| execute bulk edit | studio-bulk-edit-01 | per-item result tracked; idempotent retry; partial failure explicit |
| execute bulk archive | studio-bulk-archive-01 | lifecycle rule enforced; partial result observable; recovery available |
| execute bulk tag | studio-bulk-tag-01 | taxonomy references valid; duplicate tag relation safe; partial result explicit |
| execute bulk status transition | studio-bulk-status-01 | each transition individually validated; illegal transitions rejected |
| create draft version | studio-version-create-01 | immutable version identity; parent chain correct |
| list versions | studio-version-list-01 | only authorized versions returned; deterministic ordering |
| calculate version diff | studio-version-diff-01 | diff deterministic; no hidden mutation; version identities preserved |
| select preview version | studio-preview-version-01 | version exists and authorized; preview state points to exact version |
| validate restore target | studio-restore-validate-01 | target version eligible; published immutability respected |
| restore version | studio-version-restore-01 | restore creates correct new state/version; authorization and idempotency enforced |
| enforce immutable published version | studio-published-immutable-01 | published snapshot cannot be mutated in place; changes create new version |
| audit version operation | studio-version-audit-01 | version actions traceable to actor/resource/time |

## 7. Creator Analytics / Operations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| calculate content views | studio-views-metric-01 | metric source/version defined; excluded invalid events; reproducible aggregation |
| calculate engagement | studio-engagement-metric-01 | event quality rules applied; aggregation reproducible |
| calculate audience | studio-audience-metric-01 | privacy-safe aggregation; time range explicit; rebuildable |
| calculate retention | studio-retention-metric-01 | cohort/window definitions explicit; calculation reproducible |
| calculate follower growth | studio-follower-growth-01 | graph source authoritative; duplicate edges excluded |
| calculate revenue summary | studio-revenue-summary-01 | ledger source authoritative; no duplicated financial fact creation |
| apply time-range filter | studio-time-filter-01 | timezone/period semantics deterministic; invalid range rejected |
| enforce analytics privacy boundary | studio-analytics-privacy-01 | unauthorized data excluded; aggregation threshold/privacy policy enforced |
| query comment moderation state | studio-comment-mod-state-01 | state from moderation authority; stale projection detectable |
| query report state | studio-report-state-01 | report status authorized; evidence-sensitive fields protected |
| query moderation state | studio-moderation-state-01 | state/version authoritative; cross-center consistent |
| query copyright state | studio-copyright-state-01 | rights state authoritative; restricted details protected |
| update notification preferences | studio-notification-pref-01 | authorized preferences persist; policy/version retained |
| update creator settings | studio-settings-01 | field-level authorization; validation deterministic; audit where sensitive |
| generate creator report | studio-report-generate-01 | durable operation identity; scope frozen at authorization; result expiry defined |
| export report safely | studio-report-export-01 | export authorization current; cross-scope data excluded; audit/evidence retained |

## 8. Organization / MCN

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create organization | org-create-01 | unique organization ID; owner assigned; duplicate retry safe |
| validate legal profile | org-legal-profile-validate-01 | required legal fields validated; sensitive fields protected |
| transition organization status | org-status-transition-01 | only legal transitions accepted; audit retained |
| assign owner | org-owner-assign-01 | owner authorization required; previous owner handling deterministic |
| enroll member | org-member-enroll-01 | membership unique; scope assigned; authorization enforced |
| remove member | org-member-remove-01 | removal authorized; delegated permissions converge |
| assign organization role | org-role-assign-01 | least privilege enforced; cross-organization assignment denied |
| create team | org-team-create-01 | team scoped to organization; unique ID; owner established |
| create workspace | org-workspace-create-01 | workspace scoped; membership inheritance explicit |
| issue invitation | org-invite-01 | invitation scoped/expiring; duplicate invitation policy deterministic |
| accept invitation | org-invite-accept-01 | token/actor binding verified; membership created once |
| revoke invitation | org-invite-revoke-01 | revoked token unusable; audit retained |
| grant delegated permission | org-delegation-grant-01 | delegation bounded by resource/action/expiry; audit retained |
| revoke delegated permission | org-delegation-revoke-01 | revoke takes immediate effect; stale tokens rejected |
| create representation request | mcn-representation-request-01 | request durable; creator/organization scopes captured |
| approve representation | mcn-representation-approve-01 | authorized approver; scope explicit; resulting relation authoritative |
| update representation scope | mcn-representation-scope-01 | new scope cannot exceed grant; version/audit updated |
| evaluate expiry | mcn-representation-expiry-01 | expiry deterministic; expired representation no longer grants access |
| terminate representation | mcn-representation-terminate-01 | relation terminated; permissions converge; audit retained |
| list represented creators | mcn-represented-creators-01 | only authorized representations returned; pagination stable |
| create contract | mcn-contract-create-01 | contract ID unique; parties/scope captured; authorization enforced |
| create contract version | mcn-contract-version-01 | version chain immutable; effective date rules applied |
| validate effective date | mcn-contract-effective-date-01 | conflicting dates rejected; timezone semantics deterministic |
| validate expiry date | mcn-contract-expiry-date-01 | expiry after effective date; policy constraints applied |
| persist revenue-share terms | mcn-revenue-share-terms-01 | terms versioned; financial owner remains ledger/settlement domain |
| persist rights-scope terms | mcn-rights-scope-terms-01 | rights scope explicit; source rights authority referenced |
| terminate contract | mcn-contract-terminate-01 | only authorized termination; effective state/version recorded |
| attach dispute reference | mcn-dispute-reference-01 | dispute ID canonical; contract remains traceable |
| create campaign | mcn-campaign-create-01 | campaign scoped to organization; owner assigned; duplicate-safe |
| associate sponsor | mcn-sponsor-associate-01 | sponsor relation authorized; campaign scope respected |
| assign creator | mcn-campaign-creator-assign-01 | represented creator required where policy demands; assignment auditable |
| assign content | mcn-campaign-content-assign-01 | content ownership/rights validated; duplicate relation prevented |
| aggregate campaign metrics | mcn-campaign-metrics-01 | source events quality-filtered; aggregation rebuildable |
| bind settlement reference | mcn-settlement-ref-01 | canonical settlement reference only; no financial fact duplicated |
| execute approval workflow | mcn-approval-workflow-01 | required approvers enforced; state machine deterministic |
| record governance audit | mcn-governance-audit-01 | privileged governance action traceable; sensitive fields redacted |
| create dispute case | mcn-dispute-case-01 | durable case identity; participant scopes protected |
| revoke access | mcn-access-revoke-01 | access removed according to scope; stale permissions rejected |
| validate identity/ownership separation | mcn-separation-check-01 | conflicted roles detected; high-risk dual-control rule enforced where applicable |

## 9. Mandatory Cross-Cutting Inheritance

```text
160 Lifecycle
163 Event semantics
164 Saga where cross-domain
165 Async for verification/export/report/transfer workflows
166 Error / State
167 Cache / projections
168 Scope / Tenant / Organization isolation
169 Security / Incident
170 Rate / Quota
171 Observability
172 Localization / Time
173 Accessibility for user-facing studio flows
174 Canonical ID
175 Configuration / Policy
176 Evidence
```

## 10. Readiness

```text
L4 inventory scope                 = CLOSED
L5 instance coverage               = CLOSED
L6 minimum claim coverage          = CLOSED
Cross-cutting inheritance         = CLASSIFIED
Contract refs                     = REQUIRED BEFORE READY
Test refs                         = REQUIRED BEFORE READY
Evidence                          = REQUIRED BEFORE PASS
Implementation                    = NOT AUTHORIZED
CL                                = NOT RUN
CI                                = NOT RUN
```

## 11. STOP

- any listed L4 cannot map to authoritative 36;
- duplicate L5 parentage;
- L5 lacks execution fields;
- L6 claim is not atomic/verifiable;
- ownership/scope/security inheritance missing;
- financial or rights facts are duplicated outside their authority;
- implementation marked READY without contract/test/evidence references.
