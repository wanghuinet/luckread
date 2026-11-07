# LuckRead Native App

Expo / React Native client source for LuckRead. The root web application and the native application remain separate projects: run package manager commands from this `app/` directory.

## Local development

Requirements: Node.js 22.13+ for the Expo SDK 58 baseline (CI uses Node.js 22.13.1), Bun 1.1.x, Android Studio for Android builds, and macOS with Xcode + CocoaPods for iOS builds.

```sh
cd app
bun install
bunx expo install --check
bunx expo-doctor@latest
bun run typecheck       # TypeScript 7 native compiler
bun run typecheck:ts6   # TypeScript 6 API compatibility check
bun start
```

Build a native development app:

```sh
bun run android
bun run ios
```

The GitHub Actions workflow `.github/workflows/app-mobile-ci.yml` installs dependencies, checks the Expo SDK 58 compatibility, type-checks the client, verifies native Codegen, and builds the Android Release APK. The SDK 58 Android baseline uses compile API 37 and target API 36; iOS builds require Xcode 26.4 or newer.

## API configuration

The default API base is `https://api.luckread.com`. Override it for staging with:

```sh
EXPO_PUBLIC_API_BASE_URL=https://your-staging-host.example bun start
```

The client uses these existing W01 public routes:

- `POST /v1/auth/login`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`
- `GET /v1/contents?type=post&limit=20`
- `GET /v1/feed/following?limit=20`

The native session credential is accepted from the `X-LuckRead-Session-Token` response header and stored using `expo-secure-store` (iOS Keychain / Android Keystore-backed storage). Authenticated requests use `Authorization: Bearer <session-token>`. The token is never stored in plain AsyncStorage or included in a request/response JSON body.

## Current scope and limitations

- Public For You posts and authenticated Following timeline are connected to W01.
- Login and startup session validation use the frozen APP-AUTH-01 contract. Production end-to-end acceptance of valid sign-in/session-revocation still needs a QA credential-backed run.
- Post cards currently map the public content list fields supported by the W01/W03 response. This does not yet connect native like/repost/comment writes, image/video upload, media playback authorization, push notifications, or creator subscriptions.
- The imported UI still contains other upstream prototype screens and placeholders. Those are not evidence that the equivalent LuckRead business function is implemented.

This client should not be considered release-ready until the dependency checks and both native build jobs pass and device-level auth/feed tests are completed.
