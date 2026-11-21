# LuckRead L5/L6 Messaging / Live / Audio / Series Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Messaging、IM、Realtime、Live、Audio、Podcast、Series / Program 相关现有 L4，并与 56、58、59、60、71、160–176、179、180 建立执行、实时性与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Messaging / Conversation Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate conversation ID | messaging-conversation-id-01 | ID unique/non-reused; canonical participants resolved |
| create conversation | messaging-conversation-create-01 | participant scope validated; authority established once |
| add participant | messaging-participant-add-01 | permission checked; duplicate membership prevented |
| remove participant | messaging-participant-remove-01 | authorized removal; unread/projection semantics converge |
| leave conversation | messaging-conversation-leave-01 | membership state durable; access rules updated |
| mute conversation | messaging-conversation-mute-01 | mute state explicit; notification projection converges |
| archive conversation | messaging-conversation-archive-01 | archived state durable; restore semantics explicit |
| restore conversation | messaging-conversation-restore-01 | eligibility checked; derived views repaired |
| delete conversation | messaging-conversation-delete-01 | deletion semantics explicit; retention/lifecycle applied |
| resolve conversation visibility | messaging-conversation-visibility-01 | participant/block/privacy policy enforced |

## 2. Message Send / Delivery / Read State

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate message ID | messaging-message-id-01 | ID unique/non-reused; client retry correlation supported |
| validate message | messaging-message-validate-01 | schema/type/size policy enforced |
| persist message | messaging-message-persist-01 | authoritative message state durable before accepted result |
| send message | messaging-message-send-01 | send idempotent; one effective message per operation identity |
| fanout message | messaging-message-fanout-01 | recipient set resolved from authority; duplicate delivery safe |
| acknowledge delivery | messaging-delivery-ack-01 | delivery status attributable and monotonic |
| mark read | messaging-read-mark-01 | read cursor monotonic; actor scope enforced |
| edit message | messaging-message-edit-01 | authorization/version policy enforced; audit retained |
| recall message | messaging-message-recall-01 | recall state authoritative; derived surfaces converge |
| delete message | messaging-message-delete-01 | deletion state durable; retention rules applied |
| paginate messages | messaging-message-page-01 | stable cursor; bounded page; visibility policy applied |

## 3. Realtime / Presence / Notification

| L4 | L5 | L6 minimum claims |
|---|---|---|
| establish realtime session | realtime-session-create-01 | session ID unique; auth/scope validated |
| authenticate realtime channel | realtime-channel-auth-01 | channel permission enforced before subscription |
| subscribe conversation | realtime-conversation-subscribe-01 | participant/visibility scope checked |
| unsubscribe conversation | realtime-conversation-unsubscribe-01 | subscription removed deterministically |
| publish realtime event | realtime-event-publish-01 | event schema/version valid; duplicate semantics defined |
| deliver realtime event | realtime-event-deliver-01 | delivery retry/order guarantees explicit |
| detect presence | realtime-presence-detect-01 | presence state TTL/heartbeat semantics deterministic |
| update presence | realtime-presence-update-01 | actor scope enforced; stale state expires safely |
| resolve online state | realtime-presence-query-01 | current state bounded by freshness policy |
| materialize message notification | messaging-notification-materialize-01 | recipient eligibility/privacy/mute/block applied |
| suppress duplicate notification | messaging-notification-dedupe-01 | canonical event/message identity deduplicated |

## 4. Abuse / Privacy / Messaging Safety

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enforce messaging permission | messaging-permission-01 | actor/recipient scope checked before mutation |
| block message delivery | messaging-block-filter-01 | blocked pair excluded before delivery |
| mute message notification | messaging-mute-filter-01 | mute policy consistently applied |
| detect spam message | messaging-spam-detect-01 | signal attributable; raw score not authority |
| rate-limit sender | messaging-rate-limit-01 | configured quota enforced; retry semantics explicit |
| quarantine message | messaging-quarantine-01 | restricted state durable; serving excluded |
| create messaging safety case | messaging-safety-case-01 | case/message/version linked and auditable |
| appeal messaging restriction | messaging-appeal-01 | exact decision/policy/version linked |

## 5. Live Session Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create live session | live-session-create-01 | session ID unique; host authority validated |
| configure live session | live-session-config-01 | permitted settings/version enforced |
| schedule live session | live-session-schedule-01 | time/region policy deterministic; duplicate schedule safe |
| start live session | live-session-start-01 | start allowed only from eligible state; state durable |
| end live session | live-session-end-01 | terminal state explicit; recording/fanout consequences handled |
| join live session | live-session-join-01 | audience eligibility checked |
| leave live session | live-session-leave-01 | participant state converges |
| assign live moderator | live-moderator-assign-01 | role scope validated; audit retained |
| remove live moderator | live-moderator-remove-01 | authority revoked; derived permissions invalidated |
| pause live session | live-session-pause-01 | pause semantics/version explicit |
| resume live session | live-session-resume-01 | eligible paused state restored deterministically |

## 6. Live Interaction / Events / Replay

| L4 | L5 | L6 minimum claims |
|---|---|---|
| publish live event | live-event-publish-01 | event schema/version valid; source/session canonical |
| deliver live event | live-event-deliver-01 | ordering/retry policy explicit |
| record live reaction | live-reaction-record-01 | actor/session scope validated; dedupe safe |
| record live comment | live-comment-record-01 | moderation/scope checked before display |
| record live gift/tip intent | live-gift-intent-01 | actor/payment state validated; operation idempotent |
| update live counters | live-counter-aggregate-01 | counters derived/rebuildable |
| replay live event | live-event-replay-01 | replay bounded/idempotent; terminal session not resurrected |
| reconcile live projection | live-projection-reconcile-01 | authoritative session/events re-applied; drift repair auditable |

## 7. Audio / Podcast

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create audio program | audio-program-create-01 | program ID unique; owner scope enforced |
| create podcast show | podcast-show-create-01 | show identity/version unique |
| create episode | podcast-episode-create-01 | episode references show/version correctly |
| publish episode | podcast-episode-publish-01 | rights/moderation/media readiness gates passed |
| update episode metadata | podcast-episode-metadata-01 | authorized versioned mutation |
| attach audio asset | audio-asset-attach-01 | source asset authoritative reference valid |
| generate transcript | audio-transcript-01 | transcript tied to exact source/version |
| generate chapters | audio-chapters-01 | chapter offsets deterministic and source-bound |
| generate audio preview | audio-preview-01 | preview references ready source |
| record audio play | audio-play-01 | attributable event; duplicate semantics defined |
| record audio progress | audio-progress-01 | progress state scoped and freshness bounded |
| resolve playback availability | audio-playback-availability-01 | rights/region/age/safety state enforced |

## 8. Series / Program / Episode Graph

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create series | series-create-01 | series ID unique; owner scope enforced |
| configure series | series-config-01 | allowed settings/version traceable |
| create episode | series-episode-create-01 | episode identity unique within series namespace |
| assign episode order | series-episode-order-01 | ordering deterministic; conflicting order resolved explicitly |
| publish series | series-publish-01 | eligible episodes/metadata only; policy recorded |
| publish episode | series-episode-publish-01 | media/content/rights gates complete |
| archive series | series-archive-01 | lifecycle policy applied; historical episodes queryable |
| restore series | series-restore-01 | eligibility and authority verified |
| create season | series-season-create-01 | season identity unique; parent series canonical |
| assign episode to season | series-season-attach-01 | parent/order constraints enforced |
| resolve series graph | series-graph-query-01 | parent/season/episode relations canonical and visibility-safe |
| rebuild series projection | series-projection-rebuild-01 | derived graph rebuilt from authoritative relations |

## 9. Search / Feed / Notification Projection Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| index message-eligible entity | realtime-search-projection-01 | only eligible public entity fields indexed |
| index live session | live-search-projection-01 | current visibility/rights state reflected |
| index audio program | audio-search-projection-01 | canonical entity/version used |
| index series | series-search-projection-01 | graph state and visibility filters applied |
| emit activity event | media-activity-event-01 | event identity/source canonical |
| rebuild activity projection | media-activity-rebuild-01 | replay from authoritative source; stale rows removed |

## 10. Async / Recovery / Backpressure

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue message fanout | messaging-fanout-job-01 | operation/event unique; recipient set/version traceable |
| retry message delivery | messaging-delivery-retry-01 | bounded retry/backoff; duplicate safe |
| dead-letter message event | messaging-event-dlq-01 | terminal failure retained; replay eligibility explicit |
| enqueue live processing | live-processing-enqueue-01 | job key unique; payload schema validated |
| retry live processing | live-processing-retry-01 | retry bounded; backpressure semantics explicit |
| dead-letter live processing | live-processing-dlq-01 | terminal failure retained and observable |
| recover audio processing | audio-processing-recover-01 | recovery idempotent; source/version unchanged |
| reconcile realtime lag | realtime-lag-reconcile-01 | lag detected; degraded behavior explicit |

## 11. Cross-Cutting Inheritance

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
173 Accessibility for messaging/live/audio/series surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 12. Authority / Runtime Boundary

- Conversation and message durable state has one authoritative source; realtime transport is delivery infrastructure, not business authority.
- Presence is ephemeral/derived and MUST expire safely; stale presence MUST NOT become durable identity state.
- Live session state is authoritative for session lifecycle; transport/provider state requires reconciliation before business state changes.
- Audio/Series metadata and relationships are authoritative in the corresponding domain; media blobs are storage representations only.
- Notification/activity/search projections are derived and rebuildable.
- External realtime/media providers MUST remain behind adapter and contract boundaries.

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

- realtime delivery treated as business authority;
- blocked/muted recipient receives restricted message;
- duplicate send creates multiple effective messages;
- stale presence treated as current authoritative state;
- live provider callback bypasses session authority;
- incomplete media/rights state becomes publishable;
- replay resurrects terminal live/series/message state;
- external provider state duplicated as independent business authority;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
