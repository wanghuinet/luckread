# LuckRead L5/L6 Media / Media Processing Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

覆盖 `36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` 中 Media、Media Processing、Asset / File 相关现有 L4，并与 57、71、160–176、179、180 建立执行与证据边界。

仅本文件列出的 L4 被视为 scope-closed。

## 1. Media Identity / Asset Lifecycle

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate media ID | media-id-generate-01 | ID unique/non-reused; canonical namespace applied |
| validate media type | media-type-validate-01 | supported type accepted; unsupported type rejected |
| bind media owner | media-owner-bind-01 | owner scope enforced; unauthorized owner rejected |
| bind creator | media-creator-bind-01 | creator relation authorized; duplicate relation prevented |
| bind content | media-content-bind-01 | content relation authorized; lifecycle-compatible |
| create asset record | asset-record-create-01 | metadata durable; object reference unique |
| upload intent | media-upload-intent-01 | scope/type/size policy validated before upload |
| complete upload | media-upload-complete-01 | object existence verified; authoritative metadata updated before success |
| mark processing | media-processing-mark-01 | processing state transition deterministic |
| mark ready | media-ready-mark-01 | output integrity verified; ready state authoritative |
| mark failed | media-failed-mark-01 | failure durable; retryability explicit; safe user error |
| quarantine asset | media-quarantine-01 | unsafe asset excluded from public serving; audit retained |
| archive asset | media-archive-01 | retention policy applied; archived state queryable |
| request deletion | media-delete-request-01 | deletion intent durable; 160 lifecycle linked |
| execute deletion | media-delete-execute-01 | object/reference cleanup complete; final state verifiable |
| restore asset | media-restore-01 | eligible asset restored; scope and policy enforced |
| reject illegal transition | media-transition-guard-01 | illegal transition denied; no partial mutation |

## 2. Media Metadata / Reference Integrity

| L4 | L5 | L6 minimum claims |
|---|---|---|
| persist MIME type | media-mime-persist-01 | normalized MIME stored; mismatch rejected |
| persist size | media-size-persist-01 | authoritative object size validated |
| persist checksum | media-checksum-persist-01 | checksum deterministic; mismatch detected |
| persist dimensions | media-dimensions-persist-01 | width/height valid for supported media |
| persist duration | media-duration-persist-01 | duration valid; negative/overflow rejected |
| persist encoding | media-encoding-persist-01 | codec/container values normalized |
| persist language | media-language-persist-01 | supported locale accepted; semantics deterministic |
| persist storage reference | media-storage-ref-persist-01 | storage key unique/canonical; no business authority in blob store |
| resolve public reference | media-public-ref-resolve-01 | only eligible media exposed; stable reference returned |
| validate access scope | media-access-scope-01 | viewer/owner/organization scope enforced |
| validate signed access | media-signed-access-01 | expiry/scope/resource binding enforced |
| resolve region availability | media-region-policy-01 | regional policy applied; policy version traceable |
| resolve age/safety policy | media-safety-policy-01 | prohibited media excluded; current policy recorded |
| validate derivative relation | media-derivative-ref-01 | source/version provenance retained |

## 3. Image / Document Processing

| L4 | L5 | L6 minimum claims |
|---|---|---|
| generate thumbnail | image-thumbnail-01 | deterministic dimensions/format; source authorized |
| generate preview | image-preview-01 | preview references exact source version |
| strip unsafe metadata | image-metadata-sanitize-01 | configured sensitive metadata removed |
| validate image dimensions | image-dimensions-validate-01 | limits enforced; invalid image rejected |
| optimize image | image-optimize-01 | output decodable; quality/size policy satisfied |
| convert image format | image-format-convert-01 | output format allowed; source provenance retained |
| validate document | document-validate-01 | supported format parsed; malformed file rejected |
| generate document preview | document-preview-01 | preview tied to exact source version |
| generate document thumbnail | document-thumbnail-01 | thumbnail derived from authorized source |
| scan document safety | document-safety-scan-01 | prohibited content/state blocks publication/serving |

## 4. Video Processing

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create video ingest job | video-ingest-job-01 | job unique/idempotent; source authorized |
| validate video container | video-container-validate-01 | allowed container accepted; malformed input rejected |
| inspect video metadata | video-inspect-01 | dimensions/duration/codec extracted deterministically |
| transcode video | video-transcode-01 | configured profiles produced; partial output not published |
| generate poster | video-poster-01 | poster tied to source version |
| generate preview clip | video-preview-01 | duration/rights constraints enforced |
| generate adaptive renditions | video-rendition-01 | rendition manifest complete; unsupported profile rejected |
| validate playback readiness | video-playback-ready-01 | required outputs complete before ready state |
| publish playback manifest | video-manifest-publish-01 | manifest references ready outputs only |
| fail/retry video job | video-job-retry-01 | retry bounded/idempotent; terminal failure explicit |

## 5. Audio / Streaming Media Processing

| L4 | L5 | L6 minimum claims |
|---|---|---|
| validate audio input | audio-input-validate-01 | supported codec/container accepted |
| normalize audio | audio-normalize-01 | output decodable; configured normalization applied |
| transcode audio | audio-transcode-01 | target profile complete; partial output unpublished |
| generate waveform | audio-waveform-01 | waveform tied to exact source version |
| generate audio preview | audio-preview-01 | preview duration/policy constrained |
| validate stream media | stream-media-validate-01 | stream target and media relation valid |
| generate stream manifest | stream-manifest-01 | manifest complete and references ready outputs |

## 6. Moderation / Rights / Quality Gates

| L4 | L5 | L6 minimum claims |
|---|---|---|
| run malware scan | media-malware-scan-01 | malicious artifact blocked and result auditable |
| run content safety scan | media-content-safety-01 | current policy version recorded; blocking result authoritative |
| run copyright fingerprint | media-copyright-fingerprint-01 | fingerprint deterministic; source/version traceable |
| validate rights window | media-rights-window-01 | current territory/time rights enforced |
| validate usage license | media-license-check-01 | license scope/expiry checked before public access |
| execute quality gate | media-quality-gate-01 | required checks complete; blocking failures explicit |
| create moderation case | media-moderation-case-01 | case durable; media/version linked |
| appeal media decision | media-appeal-01 | decision linked to exact asset/version/policy |

## 7. Processing Orchestration / Async / Recovery

| L4 | L5 | L6 minimum claims |
|---|---|---|
| enqueue processing job | media-job-enqueue-01 | queue event unique; payload schema valid |
| claim processing job | media-job-claim-01 | lease/lock prevents duplicate active execution |
| heartbeat job | media-job-heartbeat-01 | liveness recorded; timeout policy deterministic |
| retry processing job | media-job-retry-01 | retry count bounded; backoff policy deterministic |
| dead-letter failed job | media-job-dlq-01 | terminal failure retained; replay eligibility explicit |
| replay processing job | media-job-replay-01 | replay idempotent; source/version unchanged |
| cancel processing job | media-job-cancel-01 | cancellation state durable; late completion cannot regress authority |
| rebuild processing projection | media-processing-rebuild-01 | projection rebuilt from authoritative state/events; stale output ignored |
| reconcile asset/object drift | media-object-reconcile-01 | orphaned/missing objects detected; repair auditable |

## 8. Serving / CDN / Cache Boundary

| L4 | L5 | L6 minimum claims |
|---|---|---|
| resolve cache key | media-cache-key-01 | key canonical and scope-safe |
| invalidate media cache | media-cache-invalidate-01 | invalidation reaches affected projections |
| protect hot asset | media-hot-key-protect-01 | hot-key strategy prevents stampede |
| generate cacheable reference | media-cache-reference-01 | cache contains derived access state only |
| enforce signed URL expiry | media-url-expiry-01 | expired URL rejected; no scope escalation |
| enforce download policy | media-download-policy-01 | policy and rights checked before transfer |
| serve only ready asset | media-ready-serving-01 | failed/quarantined/deleted media never served |

## 9. Cross-Cutting Inheritance

```text
160 Lifecycle / retention / erasure
161 Backup / DR / BCP
162 Schema / migration / backfill
163 Event delivery / ordering / replay / DLQ
164 Saga / compensation where media + content/payment/rights cross domains
165 Unified async operation
166 Error / state taxonomy
167 Cache / invalidation / hot-key / stampede
168 Scope / tenant / organization isolation
169 Security / secret / key lifecycle / incident
170 Rate / quota / traffic shaping
171 Observability / SLI / SLO / error budget
172 Localization / region / time / currency
173 Accessibility for editor/public consumption surfaces
174 Canonical ID / entity reference / uniqueness
175 Feature flag / config / policy versioning
176 Evidence registry / acceptance traceability
```

## 10. Runtime / Storage Boundary

- R2/object storage is blob storage only; structured metadata/state remains authoritative in the platform data layer.
- Processing workers/jobs MUST NOT publish incomplete outputs.
- Media Processing MAY be asynchronous, but user-visible state MUST remain explicit and durable.
- External media/processing services, when adopted, MUST be behind an adapter and contract boundary.
- Cache/CDN state is derived and rebuildable; it is never the business authority.

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

- publish before media is authoritative-ready;
- serve quarantined/failed/deleted media;
- object reference without canonical asset ID;
- derivative without source/version provenance;
- rights/safety gate bypass;
- duplicate processing creates conflicting authority;
- replay resurrects deleted media;
- cache becomes business authority;
- L5 lacks parent L4;
- L6 lacks deterministic verification;
- implementation marked READY without contract/test/evidence refs.
