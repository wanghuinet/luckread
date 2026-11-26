# LuckRead Beta Release Blocker Register

- Current main SHA at last baseline refresh: `59a9f7020721d781e676adf374c7d4cf2d6d6846`
- Updated: 2026-11-27
- Overall status: `RELEASE_NOT_GREEN`
- Purpose: one release-oriented register to replace repetitive audit loops with evidence-driven closure. This is not a release approval.

## Rules

1. Track verifiable release-impacting findings only. Do not reopen sealed scopes without new evidence or relevant code/config changes.
2. Distinguish source review, automated CI, remote runtime verification, native build, device acceptance, and store/compliance evidence.
3. Passing CI or merging a PR is not device or production acceptance.
4. Batch related repairs into coherent PRs. Avoid duplicate PRs and unnecessary full CI runs.
5. Unverified items remain `NOT_VERIFIED`.
6. Beta readiness is not feature parity with X/Threads; defer non-critical advanced features explicitly.

## Baseline evidence snapshot

- Historical register-creation baseline: `2bf2fe61e672a32440e77fbacf88a289afbfe0ec`.
- PR #2246 (native app feature inventory and release gates) merged at `183fe10faa0532314f3e0ee32b1c8e5ad7261129`.
- PR #2247 (Neon media runtime E2E release blocker record) merged at `d49eab250872b713e7fe3ebaccb04bb2d5f1c1ae`.
- PR #2271 (manual protected-main confirmation for one-time production launch) merged at `002ca8e2649be944f2ad85d098d8bb4709109d95`; superseded PR #2265 was closed unmerged.
- PR #2272 refreshed the release blocker register; PR #2273 disabled the unsafe legacy media E2E workflow. PR #2273 merge commit is the baseline main SHA above.
- The baseline is a repository-state snapshot, not release acceptance. Recheck main and open PRs before using it as a live queue status.
- Skipped native build jobs and empty check-run sets are not build or runtime acceptance evidence.

## Release workstreams

| ID | Workstream | Status | Exit evidence / scope |
|---|---|---|---|
| R-01 | Release inventory & criteria | `IN_PROGRESS` | Route/API/worker/database inventory mapped to core journeys and blocker criteria |
| R-02 | Auth, session, multi-account, access control | `NOT_VERIFIED` | Auth/session; switching; revocation/expiry; permissions; isolation; deletion/recovery |
| R-03 | API & Worker production boundary | `NOT_VERIFIED` | Routes, routing, error handling, validation, authorization, throttling, secrets, env |
| R-04 | Neon schema, migrations, integrity | `NOT_VERIFIED` | Migration lineage, data integrity, recovery and operational backup evidence |
| R-05 | Core social/feed/profile/search | `NOT_VERIFIED` | Feed/pagination, detail, follow, like, repost, comments, search, profile, block/report |
| R-06 | Publish & media | `BLOCKED` | Isolated Neon-backed Worker/R2/W03 media runtime E2E and exact deployment provenance required |
| R-07 | Messaging & notifications | `INTEGRATION_ONLY` | Previously deep-audited messaging is closed against repeat audits; only integration regression or new evidence reopens |
| R-08 | Payments, membership, creator features | `NOT_VERIFIED` | Entitlements, billing, payment failure/refund/duplicate handling and creator flows in Beta scope |
| R-09 | UI, navigation, accessibility, reliability | `IN_PROGRESS` | 32 Expo Router screen/layout files inventoried; route-by-route interaction and runtime acceptance still required |
| R-10 | Native release build & install | `NOT_VERIFIED` | Build provenance, signed APK/AAB/iOS build, install and core journey evidence |
| R-11 | Privacy, moderation & store readiness | `NOT_VERIFIED` | Privacy disclosures, deletion, report/block, terms, store metadata and platform requirements |
| R-12 | Observability & rollout | `NOT_VERIFIED` | Crash/error telemetry, alerts, rollback/OTA strategy and incident response evidence |

## Confirmed source-level finding: media runtime E2E is unsafe and not valid acceptance

- `.github/workflows/w01-payload-app-deploy.yml` deploys W01 using its Neon configuration, with `PAYLOAD_DATABASE_DRIVER=neon`, no production D1 bindings, and Neon Hyperdrive.
- `.github/workflows/media-runtime-e2e.yml` still contains fixture setup/cleanup using `wrangler d1 execute`; this does not match the deployed Neon W01 database path.
- The legacy workflow previously had a production deployment trigger and a default production API target. PR #2273 removed automatic deployment triggering and hard-disabled the job (`if: ${{ false }}`). It remains a safety hold, not a successful test.
- A regression test is being added to assert that the workflow remains manual-only and disabled until an isolated non-production W01 and Neon test database are available.
- W01 Wrangler source currently names its R2 binding target `luckread-w01-assets-placeholder`. This source value is not proof that the bucket exists or that a separate test bucket is provisioned. W01 also declares service bindings to the named W02/W03/W04/W05/W06/W07/W08/W11 services; no independent media test topology is established by these source configs.
- The repository's Hyperdrive staging verifier reports `SOURCE_CONFIG_STAGED_ONLY`, with runtime drivers disabled and no production deployment performed. It validates source configuration only.
- Required before R-06 can close: dedicated non-production W01; isolated Neon test database; isolated R2 bucket/prefix; W03 test service or controlled binding substitute; fail-closed fixture creation and run-scoped cleanup; owner/non-owner/anonymous authorization checks; metadata mutation/deletion; visibility/entitlement checks; and actual R2 object delivery/cleanup.
- Do not run the current legacy workflow against production, and do not substitute production `DATABASE_URL` or production Worker service bindings for test resources.

## Existing documented acceptance gaps

- Physical device/build/production checks cannot be marked verified without actual evidence.
- The publish-window closure document distinguishes full-file retry from byte-level resumable upload; do not claim resumability without evidence and scope approval.
- Native app feature inventory and release-gate documentation have been merged, but source presence and regression suites do not prove production E2E.
- The absence of a verified isolated media runtime environment keeps R-06 blocked; local PostgreSQL schema rehearsal is not full Cloudflare Worker/R2/W03 acceptance.

## Batch closure protocol

Inventory contracts/code → prioritize blockers → grouped repairs → targeted tests → affected gates → one coherent PR → review evidence → merge only with explicit current authorization → update this register against merged SHA. Do not repeat sealed audits.

## Release verdict

Beta is not ready while a P0 blocker is unresolved, core acceptance is incomplete, or release-critical build/install/privacy evidence is missing. Report remaining gaps honestly.
