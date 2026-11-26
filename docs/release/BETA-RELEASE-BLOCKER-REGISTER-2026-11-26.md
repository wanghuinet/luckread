# LuckRead Beta Release Blocker Register

- Baseline SHA: `4f47d8d303c4919bd833f12554092533339885ca`
- Updated: 2026-11-26
- Overall status: `RELEASE_NOT_GREEN`
- Purpose: one release-oriented register to replace repetitive module audits with evidence-driven closure. This is not a release approval.

## Rules
1. Track verifiable release-impacting findings only. No re-opening sealed scopes without new evidence or relevant code/config changes.
2. Distinguish source review, automated CI, remote runtime verification, native build, device acceptance, and store/compliance evidence.
3. Passing CI or merged PR is not device or production acceptance.
4. Batch related repairs into coherent PRs. Avoid duplicate PRs and unnecessary full CI runs.
5. Unverified items remain `NOT_VERIFIED`.
6. Beta readiness is not feature parity with X/Threads; defer non-critical advanced features explicitly.

## Baseline evidence snapshot
- Main SHA: `4f47d8d303c4919bd833f12554092533339885ca`.
- Open PRs at snapshot: none.
- Latest Mapping 0 Structural Gate run for main at snapshot: success.
- This does not establish full release readiness.

## Release workstreams

| ID | Workstream | Status | Exit evidence / scope |
|---|---|---|---|
| R-01 | Release inventory & criteria | `IN_PROGRESS` | Route/API/worker/database inventory mapped to core journeys and blocker criteria |
| R-02 | Auth, session, multi-account, access control | `NOT_VERIFIED` | Auth/session; switching; revocation/expiry; permissions; isolation; deletion/recovery |
| R-03 | API & Worker production boundary | `NOT_VERIFIED` | Routes, routing, error handling, validation, authorization, throttling, secrets, env |
| R-04 | Neon schema, migrations, integrity | `NOT_VERIFIED` | Migration lineage, data integrity, recovery and operational backup evidence |
| R-05 | Core social/feed/profile/search | `NOT_VERIFIED` | Feed/pagination, detail, follow, like, repost, comments, search, profile, block/report |
| R-06 | Publish & media | `NOT_VERIFIED` | Draft, create/edit/delete, upload retry, media policy/playback, schedule and recovery |
| R-07 | Messaging & notifications | `NOT_VERIFIED` | Previously deep-audited messaging is closed against repeat audits; only integration regression or new evidence reopens |
| R-08 | Payments, membership, creator features | `NOT_VERIFIED` | Entitlements, billing, payment failure/refund/duplicate handling and creator flows in Beta scope |
| R-09 | UI, navigation, accessibility, reliability | `NOT_VERIFIED` | Route/control completeness, states, crash boundary, offline/restore, accessibility/localization |
| R-10 | Native release build & install | `NOT_VERIFIED` | Build provenance, APK/AAB/iOS build, signing, install and core journey evidence |
| R-11 | Privacy, moderation & store readiness | `NOT_VERIFIED` | Privacy disclosures, deletion, report/block, terms, store metadata and platform requirements |
| R-12 | Observability & rollout | `NOT_VERIFIED` | Crash/error telemetry, alerts, rollback/OTA strategy and incident response evidence |

## Existing documented acceptance gaps
- Native app release documentation still records device and authenticated E2E acceptance as not green.
- The publish-window closure document distinguishes full-file retry from byte-level resumable upload; do not claim resumability without evidence and scope approval.
- Native README claims several flows incomplete/placeholders. Reconcile claims against current code/tests rather than assuming either is authoritative.
- Physical device/build/production checks cannot be marked verified without actual evidence.

## Batch closure protocol
Inventory contracts/code → prioritize blockers → grouped repairs → targeted tests → affected gates → single coherent PR → review evidence → merge only under explicit current authorization → update this register against merged SHA. Do not repeat sealed audits.

## Release verdict
Beta is not ready while a P0 blocker is unresolved, core acceptance is incomplete, or release-critical build/install/privacy evidence is missing. Report remaining gaps honestly.
