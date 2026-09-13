# LuckRead L5/L6 Social / Community / Interaction Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Social、Community、Interaction 相关现有 L4，并与 54、71、160–176、179、180 建立执行与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Social Identity / Relationship Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate relationship ID | social-rel-id-01 | ID unique/non-reused; canonical namespace applied |
| follow user | social-follow-user-01 | target eligible; scope/privacy enforced; duplicate request idempotent |
| unfollow user | social-unfollow-user-01 | authorized relation removal; projections converge |
| follow creator | social-follow-creator-01 | creator target valid; relation unique |
| follow topic | social-follow-topic-01 | topic current; duplicate relation prevented |
| block user | social-block-user-01 | block relation authoritative; affected visibility rules converge |
| unblock user | social-unblock-user-01 | authorized removal; visibility reevaluation deterministic |
| mute user | social-mute-user-01 | mute scope explicit; feed/notification projections converge |
| create friend relation | social-friend-request-01 | request state machine valid; duplicate request safe |
| accept friend relation | social-friend-accept-01 | actor authorized; symmetric relation established once |
| reject friend request | social-friend-reject-01 | terminal rejection durable; no hidden relation |
| remove friend | social-friend-remove-01 | relation removed; derived views repaired |
| resolve social relation | social-rel-query-01 | viewer/target scope enforced; result reproducible |

## 2. Reactions / Engagement

| L4 | L5 | L6 minimum claims |
|---|---|---|
| like content | interaction-like-01 | one effective like per actor/target; scope enforced |
| unlike content | interaction-unlike-01 | effective like removed; counters converge |
| add reaction | interaction-reaction-add-01 | supported reaction accepted; duplicate behavior deterministic |
| remove reaction | interaction-reaction-remove-01 | authorized removal; projection converges |
| favorite content | interaction-favorite-01 | unique actor/target relation; state queryable |
| unfavorite content | interaction-unfavorite-01 | relation removed idempotently |
| save to collection | interaction-save-collection-01 | collection scope enforced; duplicate membership prevented |
| remove from collection | interaction-unsave-collection-01 | membership removed; derived count converges |
| share content | interaction-share-01 | share event attributable; policy/risk checks applied |
| quote/share with comment | interaction-quote-share-01 | source canonical reference retained; permissions enforced |
| report content | interaction-report-content-01 | report durable; duplicate abuse controlled; case traceable |
| report user | interaction-report-user-01 | target valid; report auditable; rate limits applied |

## 3. Comment System

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create comment | comment-create-01 | actor authorized; parent/target valid; content stored durably |
| reply to comment | comment-reply-01 | parent exists; nesting policy enforced; duplicate retry safe |
| edit comment | comment-edit-01 | author/scope enforced; version/audit retained |
| delete comment | comment-delete-01 | deletion state durable; downstream projections converge |
| pin comment | comment-pin-01 | owner/mod scope enforced; one-effective-pin policy deterministic |
| unpin comment | comment-unpin-01 | authorized removal; display projection converges |
| like comment | comment-like-01 | unique actor/comment relation; counter derived |
| unlike comment | comment-unlike-01 | relation removed idempotently |
| hide comment | comment-hide-01 | moderation/owner authorization; visibility state authoritative |
| restore comment | comment-restore-01 | eligibility and authorization verified |
| resolve comment thread | comment-thread-resolve-01 | terminal/resolved semantics explicit; reopening policy deterministic |
| paginate comments | comment-page-01 | stable cursor; bounded page; visibility filters applied |

## 4. Community / Group Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create community | community-create-01 | owner scope valid; canonical ID generated |
| configure community | community-config-01 | permitted settings only; config version traceable |
| join community | community-join-01 | membership eligibility/policy enforced; duplicate safe |
| leave community | community-leave-01 | membership removal durable; derived views converge |
| invite member | community-invite-01 | inviter permission enforced; invitation idempotent |
| accept invitation | community-invite-accept-01 | recipient scope checked; membership created once |
| reject invitation | community-invite-reject-01 | invitation terminal state durable |
| remove member | community-member-remove-01 | moderator/owner scope enforced; membership removed |
| ban member | community-member-ban-01 | policy reason/status durable; access projections converge |
| unban member | community-member-unban-01 | eligibility checked; access restored deterministically |
| assign moderator | community-moderator-assign-01 | role scope valid; authority auditable |
| revoke moderator | community-moderator-revoke-01 | authority removed; cached permissions invalidated |
| dissolve community | community-dissolve-01 | irreversible policy confirmed; child relations handled safely |

## 5. Community Content / Posting

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create community post | community-post-create-01 | membership/posting permission checked |
| edit community post | community-post-edit-01 | author/mod scope; version/audit retained |
| delete community post | community-post-delete-01 | state durable; replies/reactions follow lifecycle policy |
| pin community post | community-post-pin-01 | permission checked; effective pin deterministic |
| lock community thread | community-thread-lock-01 | moderator policy enforced; new replies blocked |
| unlock community thread | community-thread-unlock-01 | authorized reopening; state auditable |
| feature community post | community-post-feature-01 | editorial scope enforced; projection converges |
| move post | community-post-move-01 | destination permission valid; references remain canonical |
| merge threads | community-thread-merge-01 | source threads retained; no silent history loss |
| list community feed | community-feed-query-01 | membership/privacy/moderation filters deterministic |

## 6. Social Notifications / Activity Projection

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create activity event | social-activity-event-01 | event schema valid; actor/target canonical IDs |
| aggregate activity | social-activity-aggregate-01 | aggregation deterministic; duplicate event safe |
| materialize notification candidate | social-notification-candidate-01 | eligibility policy applied; no unauthorized recipient |
| suppress muted activity | social-mute-filter-01 | muted relation respected across derived surfaces |
| suppress blocked interaction | social-block-filter-01 | blocked pair excluded from interaction surfaces |
| update engagement counters | social-engagement-aggregate-01 | counters derived/rebuildable; atomicity policy explicit |
| rebuild social projection | social-projection-rebuild-01 | authoritative relations/events replayed; deleted relations not resurrected |

## 7. Safety / Abuse / Privacy Guards

| L4 | L5 | L6 minimum claims |
|---|---|---|
| validate interaction permission | social-permission-01 | actor/target scope evaluated before mutation |
| enforce interaction rate limit | social-rate-limit-01 | configured quota enforced; retry behavior deterministic |
| detect engagement abuse | social-abuse-detect-01 | suspicious patterns flagged; raw signals not trusted authority |
| enforce privacy audience | social-privacy-filter-01 | audience policy applied consistently across surfaces |
| honor block/mute state | social-block-mute-enforce-01 | blocked/muted edges suppressed before delivery |
| create moderation case | social-moderation-case-01 | case durable; evidence relation traceable |
| appeal social decision | social-appeal-01 | exact decision/policy/version linked |

## 8. Async / Event / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue social event | social-event-enqueue-01 | unique event key; schema validated |
| deliver engagement event | social-event-delivery-01 | retry/ordering semantics explicit |
| retry failed event | social-event-retry-01 | bounded retry; backoff deterministic |
| dead-letter event | social-event-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay social event | social-event-replay-01 | replay idempotent; authoritative state protected |
| reconcile relation projection | social-reconcile-01 | drift detected; repair auditable |

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
173 Accessibility for community/social surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 10. Authority / Storage Boundary

- Social and Community authoritative relations/state MUST have one business authority.
- Engagement counters are derived state and MUST be rebuildable.
- Activity streams and notification candidates are derived projections, not authority.
- Cache MUST NOT become the authority for follow/block/membership/reaction state.
- Cross-domain actions such as commerce, membership, rights, or safety MUST reference the canonical entity and contract boundary rather than duplicating authority.

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

- interaction succeeds without permission/scope validation;
- duplicate mutation creates multiple effective relations;
- blocked users still receive restricted interaction;
- counters become authoritative business state;
- replay resurrects deleted relation/content;
- moderation/privacy policy bypassed;
- community authority duplicated across Center/projection/cache;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
