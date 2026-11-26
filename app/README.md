# LuckRead Native App

Expo / React Native client source for LuckRead. The root web application and the native application remain separate projects: run package manager commands from this `app/` directory.

## Local development

Requirements: Node.js 22.13+ for the Expo SDK 58 baseline (CI uses Node.js 22.13.1), Bun 1.1.x, Android Studio for local Android builds, and macOS with Xcode + CocoaPods for local iOS builds.

The APP dependency graph is pinned by `app/bun.lockb`. Regenerate and commit that lockfile whenever APP dependencies change, using the repository's Bun 1.1.38 toolchain; APP CI verifies the committed lockfile.

```sh
cd app
bun install
bunx expo install --check
bunx expo-doctor@latest
bun run typecheck
bun run typecheck:ts6
bun start
```

Build a native development app:

```sh
bun run android
bun run ios
```

The GitHub Actions workflow `.github/workflows/app-mobile-ci.yml` installs dependencies, checks Expo SDK compatibility, type-checks the client, verifies native Codegen, runs targeted native contract/regression tests, and builds the Android Release APK. The SDK 58 Android baseline uses compile API 37 and target API 36; iOS builds require Xcode 26.4 or newer.

## API configuration

The default API base is `https://api.luckread.com`. Override it for staging with:

```sh
EXPO_PUBLIC_API_BASE_URL=https://your-staging-host.example bun start
```

The native client uses the W01 API contract through the shared API client. Authentication uses the APP-AUTH-01 session contract: the native session credential is accepted from the `X-LuckRead-Session-Token` response header and stored using `expo-secure-store` (iOS Keychain / Android Keystore-backed storage). Authenticated requests use `Authorization: Bearer <session-token>`; the token is not stored in plain AsyncStorage or included in a request/response JSON body.

## Implemented native feature areas

The current source tree includes native implementations and focused regression tests for these feature areas. Their presence does not by itself prove successful production or device acceptance.

- Authentication: login, registration, email verification, password recovery, session validation, logout, secure multi-account storage/switching and session management.
- Home and discovery: For You and Following feed queries, post detail/thread, profile and relationships, search/history/trending topics, video feed and media galleries.
- Social interactions: content likes, reposts, bookmarks, comments (create/edit/delete/like/report), follow relationships, block/mute controls, sharing and post interaction summaries.
- Publishing: post composer, drafts/autosave, image/video selection and camera capture, upload preparation, media upload and playback lookup, pending-upload recovery, polls, reply audiences and scheduled publishing.
- Messaging and notifications: direct/group conversation routes, notification inbox/preferences, push permission lifecycle and push endpoint registration/cleanup.
- Creator and commerce surfaces: creator applications/plans, membership/subscription management, billing history, invoices/receipts and refund requests.

Relevant regression suites are declared in `package.json` (including auth, API client, publishing, media, social screens, comments, feed queries, notifications, subscriptions, billing, paid content and creator studio). Run the focused test command for the changed feature and the required CI gates; do not rerun unrelated suites without a reason.

## Release acceptance still required

The following are separate release gates and must not be inferred from source code or unit tests:

- Run the credential-backed production auth/session E2E, including login, protected requests, revocation/logout, with QA credentials configured in GitHub Actions.
- Run public API live smoke only after the relevant W01 routing deployment is confirmed.
- Verify media owner-scope runtime E2E against a known successful deployment artifact.
- Build the signed Android Beta artifact using the stable signing secrets for a publishable release. A temporary one-run signing key is only for device testing and must not be used for a public release.
- Build and sign iOS with the required macOS/Xcode toolchain and valid Apple signing configuration.
- Install the release artifacts on physical Android and iOS devices and complete authenticated core journeys, including app restart, network interruption/recovery, media and push permission flows.
- Complete privacy, account deletion, moderation/reporting, store metadata and platform review checks.

## Release workflow entry points

- `.github/workflows/app-mobile-ci.yml`: native CI, dependency compatibility, type checks, regression tests and Android build validation.
- `.github/workflows/app-android-beta-release.yml`: manually dispatched Android Beta APK build. Stable signing secrets are mandatory when publishing a release; temporary signing is test-only.
- `.github/workflows/app-production-release.yml`: production release workflow; inspect its required inputs and environment protections before dispatch.
- `.github/workflows/app-auth-session-live-e2e.yml`: credential-backed production auth/session verification.
- `.github/workflows/api-app-live-smoke.yml`: manually confirmed public API smoke probes after deployment.
- `.github/workflows/media-runtime-e2e.yml`: deployment-provenance-bound media ownership runtime test.

A CI pass is not a release approval. LuckRead Beta is ready only after code gates, production runtime evidence, signed build artifacts, physical-device acceptance and store/compliance requirements are all recorded as passed.
