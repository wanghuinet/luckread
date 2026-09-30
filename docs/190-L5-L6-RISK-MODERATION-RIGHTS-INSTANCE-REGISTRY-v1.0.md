# LuckRead L5/L6 Risk / Moderation / Rights Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Risk、Trust、Anti-Fraud、Moderation、Appeals、Copyright、Rights、Licensing 相关现有 L4，并与 62、63、64、71、160–176、179、180 建立执行、风控与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Risk / Trust Identity and Decisioning

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate risk case ID | risk-case-id-01 | ID unique/non-reused; canonical namespace applied |
| resolve risk subject | risk-subject-resolve-01 | canonical entity resolved; scope enforced |
| resolve risk policy | risk-policy-resolve-01 | current policy/version selected deterministically |
| calculate risk score | risk-score-01 | score version/model identifiable; input provenance retained |
| classify risk level | risk-level-classify-01 | thresholds/version explicit; deterministic classification |
| apply risk action | risk-action-01 | action authorized; scope bounded; state transition durable |
| create trust decision | trust-decision-create-01 | decision references subject/policy/version; auditable |
| update trust state | trust-state-update-01 | state transition valid; duplicate update safe |
| appeal trust decision | trust-appeal-01 | appeal linked to exact decision/policy/version |
| expire risk decision | risk-decision-expire-01 | expiration deterministic; stale decisions not treated current |

## 2. Anti-Fraud / Abuse Detection

| L4 | L5 | L6 minimum claims |
|---|---|---|
| detect suspicious login | fraud-login-detect-01 | signal attributed; policy version recorded |
| detect automated behavior | fraud-automation-detect-01 | suspicious activity classified; raw signal not authority |
| detect fake engagement | fraud-engagement-detect-01 | bot/spam pattern bounded; action auditable |
| detect account farming | fraud-account-farming-01 | linked signals scoped; false-positive handling explicit |
| detect payment abuse | fraud-payment-abuse-01 | transaction/risk reference canonical; action bounded |
| detect content abuse | fraud-content-abuse-01 | source/content relation preserved; moderation handoff explicit |
| quarantine suspicious activity | fraud-quarantine-01 | restricted state durable; release path defined |
| rate-limit abusive actor | fraud-rate-limit-01 | configured limits enforced; recovery semantics explicit |
| escalate high-risk case | fraud-escalate-01 | escalation criteria/version traceable |
| resolve fraud case | fraud-case-resolve-01 | disposition durable; downstream state convergence verified |

## 3. Moderation Intake / Classification / Action

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create moderation case | moderation-case-create-01 | case ID unique; subject/content/version linked |
| ingest moderation signal | moderation-signal-ingest-01 | schema valid; source attributable |
| classify moderation category | moderation-classify-01 | taxonomy/policy version recorded |
| assign moderation priority | moderation-priority-01 | priority rules deterministic |
| assign moderation queue | moderation-queue-assign-01 | queue routing version traceable |
| request automated review | moderation-auto-review-01 | model/rule version traceable; decision reproducible |
| request human review | moderation-human-review-01 | reviewer scope authorized; action auditable |
| issue warning | moderation-warning-01 | warning policy/version recorded; delivery attributable |
| restrict content | moderation-restrict-content-01 | restriction state authoritative; public projections converge |
| remove content | moderation-remove-content-01 | removal durable; downstream references follow lifecycle |
| restore moderated content | moderation-restore-01 | restore eligibility/policy checked |
| suspend actor | moderation-suspend-actor-01 | scope/reason/duration durable |
| unsuspend actor | moderation-unsuspend-actor-01 | authorization checked; access projections converge |
| close moderation case | moderation-case-close-01 | terminal state durable; evidence retained |

## 4. Appeals / Review / Due Process

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create appeal | appeal-create-01 | appeal ID unique; original decision linked |
| validate appeal eligibility | appeal-eligibility-01 | time/scope/status rules enforced |
| submit appeal evidence | appeal-evidence-01 | evidence linked to exact case/decision/version |
| assign appeal reviewer | appeal-reviewer-assign-01 | reviewer permission enforced; assignment traceable |
| review appeal | appeal-review-01 | reviewer/action/policy version recorded |
| uphold decision | appeal-uphold-01 | original restriction remains authoritative; result durable |
| overturn decision | appeal-overturn-01 | resulting state explicit; projections repaired |
| partially overturn | appeal-partial-overturn-01 | affected scope explicit; unchanged restrictions preserved |
| reopen appeal | appeal-reopen-01 | reopening policy explicit; state transition valid |
| close appeal | appeal-close-01 | terminal state and rationale durable |

## 5. Copyright / Rights / Licensing

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate rights record ID | rights-record-id-01 | ID unique; canonical subject reference |
| bind rights owner | rights-owner-bind-01 | ownership/authority verified; scope enforced |
| bind rights territory | rights-territory-bind-01 | territory normalized; policy version traceable |
| bind rights window | rights-window-bind-01 | start/end semantics deterministic; invalid window rejected |
| register license | rights-license-register-01 | license scope/terms durable; version identifiable |
| validate license | rights-license-validate-01 | active license confirmed before protected use |
| validate usage permission | rights-usage-permission-01 | use case/actor/territory/time evaluated |
| create copyright claim | copyright-claim-create-01 | claimant/source/version linked; case durable |
| fingerprint protected content | copyright-fingerprint-01 | fingerprint deterministic; algorithm/version traceable |
| match infringement candidate | copyright-match-01 | source/reference/version provenance retained |
| issue rights restriction | rights-restriction-01 | restriction state authoritative; serving projections converge |
| release rights restriction | rights-restriction-release-01 | current authority verified; state restored deterministically |
| transfer rights | rights-transfer-01 | transfer authorization verified; ownership history retained |
| revoke license | rights-license-revoke-01 | revocation durable; future use denied |
| expire license | rights-license-expire-01 | expired license not accepted as current authority |

## 6. Rights-aware Content Operations

| L4 | L5 | L6 minimum claims |
|---|---|---|
| gate publication by rights | rights-publication-gate-01 | publication denied when required rights absent |
| gate regional delivery | rights-region-delivery-gate-01 | territory policy enforced before delivery |
| gate age-restricted delivery | rights-age-delivery-gate-01 | age eligibility enforced before delivery |
| gate remix | rights-remix-gate-01 | derivative authorization/provenance verified |
| gate repost | rights-repost-gate-01 | source permission and canonical source verified |
| gate embed | rights-embed-gate-01 | embed permission and target policy verified |
| gate download | rights-download-gate-01 | download policy/license checked before transfer |
| gate monetization | rights-monetization-gate-01 | commercial use rights verified |
| gate advertisement | rights-ad-gate-01 | ad-use permission and territory verified |
| gate syndication | rights-syndication-gate-01 | destination/territory/license constraints enforced |

## 7. Safety Policy / Enforcement Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve safety policy | safety-policy-resolve-01 | current policy/version selected |
| validate prohibited category | safety-category-validate-01 | prohibited content/action rejected deterministically |
| apply visibility restriction | safety-visibility-restrict-01 | restricted state authoritative; caches converge |
| apply age gate | safety-age-gate-01 | age policy version explicit |
| apply regional block | safety-region-block-01 | regional rule applied consistently |
| create safety exception | safety-exception-create-01 | exception authority explicit; expiry/version required |
| revoke safety exception | safety-exception-revoke-01 | exception removed from all derived paths |
| audit safety decision | safety-decision-audit-01 | actor/subject/policy/version/time traceable |

## 8. Async / Event / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue moderation job | moderation-job-enqueue-01 | event/job key unique; schema valid |
| enqueue risk evaluation | risk-job-enqueue-01 | request idempotent; source version fixed |
| retry moderation/risk job | riskmod-job-retry-01 | retry bounded; backoff deterministic |
| dead-letter risk/moderation job | riskmod-job-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay risk/moderation job | riskmod-job-replay-01 | replay idempotent; no contradictory authority |
| reconcile restriction projection | restriction-reconcile-01 | authoritative decision/state re-applied; stale projection repaired |
| rebuild trust projection | trust-rebuild-01 | rebuilt from authoritative decisions/events; no phantom trust state |

## 9. Cross-Cutting Inheritance

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
173 Accessibility for moderation/appeal workflows and user-facing controls
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 10. Authority / Trust Boundary

- Risk scores and model outputs are decisions/inputs, never replacements for canonical account/content/rights authority.
- Moderation decisions MUST be tied to exact subject, content/version, policy version, actor/reviewer and durable state.
- Rights records are authoritative only within the rights domain; content, identity and commerce domains reference the canonical rights decision instead of duplicating ownership authority.
- Raw abuse/engagement signals MUST NOT directly authorize punitive state changes without the applicable risk/moderation policy gate.
- Appeals can change the authoritative moderation decision only through the defined decision state machine; cache/projection cannot override it.

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

- punitive action without attributable policy/version;
- raw signal directly becoming authoritative enforcement;
- moderation result not linked to exact subject/version;
- rights restriction bypassed by cache/CDN/projection;
- expired/revoked license accepted as active;
- appeal changes state without authorized decision transition;
- replay resurrects removed/restricted content state;
- duplicated ownership authority across domains;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
