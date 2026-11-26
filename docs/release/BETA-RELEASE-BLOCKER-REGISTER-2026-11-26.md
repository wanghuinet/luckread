# LuckRead Beta Release Blocker Register

- Baseline SHA: `2bf2fe61e672a32440e77fbacf88a289afbfe0ec`
- Updated: 2026-11-26
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
- Main SHA: `2bf2fe61e672a32440e77fbacf88a289afbfe0ec`.
- PR #2245 (register creation) merged; all 19 reported checks completed successfully.
- PR #2246 (native README feature inventory correction) remains a separate open PR; its reported checks passed. Do not merge without explicit authorization.
- The above does not establish full release readiness.

## Release workstreams

| ID | Workstream | Status | Exit evidence / scope |
|---|---|---|---|
| R-01 | Release inventory & criteria | `IN_PROGRESS` | Route/API/worker/database inventory mapped to core journeys and blocker criteria |
| R-02 | Auth, session, multi-account, access control | `NOT_VERIFIED` | Auth/session; switching; revocation/expiry; permissions; isolation; deletion/recovery |
| R-03 | API & Worker production boundary | `NOT_VERIFIED` | Routes, routing, error handling, validation, authorization, throttling, secrets, env |
| R-04 | Neon schema, migrations, integrity | `NOT_VERIFIED` | Migration lineage, data integrity, recovery and operational backup evidence |
| R-05 | Core social/feed/profile/search | `NOT_VERIFIED` | Feed/pagination, detail, follow, like, repost, comments, search, profile, block/report |
| R-06 | Publish & media | `BLOCKED` | Media runtime E2E contains a D1-only fixture setup incompatible with deployed Neon W01 configuration; repair and rerun against exact deployment provenance |
| R-07 | Messaging & notifications | `INTEGRATION_ONLY` | Previously deep-audited messaging is closed against repeat audits; only integration regression or new evidence reopens |
| R-08 | Payments, membership, creator features | `NOT_VERIFIED` | Entitlements, billing, payment failure/refund/duplicate handling and creator flows in Beta scope |
| R-09 | UI, navigation, accessibility, reliability | `IN_PROGRESS` | 32 Expo Router screen/layout files inventoried; route-by-route interaction and runtime acceptance still required |
| R-10 | Native release build & install | `NOT_VERIFIED` | Build provenance, signed APK/AAB/iOS build, install and core journey evidence |
| R-11 | Privacy, moderation & store readiness | `NOT_VERIFIED` | Privacy disclosures, deletion, report/block, terms, store metadata and platform requirements |
| R-12 | Observability & rollout | `NOT_VERIFIED` | Crash/error telemetry, alerts, rollback/OTA strategy and incident response evidence |

## Confirmed source-level finding: media runtime E2E database mismatch

- `.github/workflows/w01-payload-app-deploy.yml` deploys W01 using `wrangler.neon.jsonc`, asserts `PAYLOAD_DATABASE_DRIVER=neon`, zero production D1 bindings, and Neon Hyperdrive.
- `.github/workflows/media-runtime-e2e.yml` nevertheless executes `wrangler d1 execute` using `workers/W01-payload/wrangler.jsonc` to mutate account and role fixtures.
- The inspected W01 `wrangler.jsonc` also selects Neon and declares Hyperdrive, not a `d1_databases` binding. The fixture setup therefore cannot be relied on to work against the deployed Neon runtime and does not currently provide valid media-runtime acceptance evidence.
- This is a release-gate defect, not proof that media upload itself is broken. Convert fixture setup to a safe Neon-backed path (or supported API fixture lifecycle), preserve cleanup, and run the test against the exact deployed source SHA before marking media runtime verified.
- Do not run this current workflow as a production test until the fixture database path is corrected.

## Existing documented acceptance gaps
- Native app release documentation records device and authenticated E2E acceptance as not green.
- The publish-window closure document distinguishes full-file retry from byte-level resumable upload; do not claim resumability without evidence and scope approval.
- Physical device/build/production checks cannot be marked verified without actual evidence.
- Native README feature inventory correction is pending PR #2246; source presence and regression suites do not prove production E2E.

## Batch closure protocol
Inventory contracts/code → prioritize blockers → grouped repairs → targeted tests → affected gates → one coherent PR → review evidence → merge only with explicit current authorization → update this register against merged SHA. Do not repeat sealed audits.

## Release verdict
Beta is not ready while a P0 blocker is unresolved, core acceptance is incomplete, or release-critical build/install/privacy evidence is missing. Report remaining gaps honestly.
