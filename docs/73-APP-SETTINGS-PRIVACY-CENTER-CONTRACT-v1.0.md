# LuckRead APP Settings & Privacy Center Contract v1.0

**Status:** IMPLEMENTATION-IN-PROGRESS / SETTINGS HOME, NOTIFICATIONS AND APPEARANCE IMPLEMENTED / BLOCK-MUTE CLOSEOUT IN REVIEW  
**Target:** LuckRead native APP (Android + iOS), 1.0 baseline  
**Reference experience:** X mobile + Threads mobile  
**Related contracts:**  
- `docs/40-USER-JOURNEY-AND-UX-COMPLETENESS-CONTRACT-v1.0.md`
- `docs/72-USER-CENTER-PROFILE-SETTINGS-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
- `docs/08-P0-IDENTITY-AND-API-FOUNDATION-CONTRACT-v1.0.md`

---

## 1. Purpose and Decision

This document defines the APP settings experience and its implementation/admission rules for the 1.0 release. It turns the existing broad User Center contract into a screen-level product, navigation, ownership, security, and acceptance contract; implementation status is tracked in sections 4 and 16.

The target is the **control quality and information architecture** of X and Threads, not a pixel-for-pixel copy of either product. LuckRead keeps its own visual identity and domain boundaries.

The product decision is:

1. Build one discoverable **Settings & privacy** entry and one coherent settings home.
2. Integrate existing notification, block/mute, and appearance behavior instead of rebuilding it.
3. Add only controls whose authoritative read/write path exists and is verified.
4. Treat UI-only toggles, hard-coded success, local-only substitutes for account settings, and placeholder routes as incomplete.
5. Keep advanced algorithm, creator, and platform-operator controls outside the 1.0 settings baseline unless they are already required and supported by a current contract.

**This is a design and implementation contract, not a statement that the listed capabilities are already implemented.**

## 2. Product Outcomes

A signed-in user must be able to:

- find settings from the profile/avatar menu without hunting through unrelated navigation;
- understand account identity and security state;
- control who can discover, contact, mention, reply to, and interact with them where the relevant product capability exists;
- manage blocks and mutes;
- choose which activity creates in-app/account notifications and whether this device may receive push notifications;
- control appearance and basic accessibility preferences;
- control content preferences without being forced into opaque recommendations;
- reach help, reporting, policy, and account lifecycle actions;
- understand whether a choice applies to this device, this account, a conversation, or an individual post;
- see the saved state, recover from errors, and know when a setting is unavailable.

The settings experience must not become a second home for content, social, messaging, billing, creator, or moderation records.

## 3. X / Threads Reference Matrix

The following are product patterns to adopt, not requirements to copy branding or every premium/region-specific feature.

| Area | X pattern | Threads pattern | LuckRead decision |
|---|---|---|---|
| Account and security | Account identity, password protection, security, login alerts and account access controls | Account controls are integrated with Meta account infrastructure | Provide a clear account/security entry; keep identity and session authority in the existing identity system |
| Privacy and audience | Protected posts, audience/media/tagging, discoverability, Direct Message permissions, mute/block | Follower-only replies, reply approval, quote/reply controls, message request privacy and hidden-message handling | Provide understandable audience and interaction controls; expose only capabilities backed by existing APIs |
| Notifications | Activity categories, quality filters and advanced filters | Notification categories and pause controls; per-account post notification controls | Keep account notification preferences distinct from OS permission and per-account follow alerts |
| Content controls | Content you see, muted words/accounts, sensitive content and personalization/data controls | Sensitive-content preference, hidden words and more direct feed preference controls | Include basic content controls in the 1.0 foundation; advanced algorithm steering is a later enhancement |
| Messaging | Direct Message permissions and read-receipt control | Message requests, hidden folder, individual and group chats, group membership controls | Settings must link to the actual messaging privacy controls when messaging ships; do not create fake switches before then |
| Display and accessibility | Font size, dark mode, display, accessibility, language and data usage | Device/app appearance and accessibility conventions | Provide light/dark/system, readable text, motion and media-data controls in one predictable area |
| Data and account lifecycle | Account data, personalization/data, account security and account management | Account/privacy tools connected with Meta's account infrastructure | Provide transparent export/deactivation/deletion entry points only when the end-to-end backend workflow is available |

Official product references:
- X account security: https://help.x.com/en/safety-and-security/account-security-tips
- X personalization and data: https://help.x.com/en/personalization-data-settings
- X Direct Messages privacy/read receipts: https://help.x.com/en/using-x/direct-messages
- X notification filters: https://help.x.com/en/managing-your-account/understanding-the-notifications-timeline
- X mobile display/data usage guide: https://help.x.com/en/using-x/x-ios-app
- Threads reply controls and filters: https://about.fb.com/news/2025/03/new-threads-features-more-personalized-experience-you-control/
- Threads messaging, message requests and group chats: https://about.fb.com/news/2025/07/introducing-messaging-highlighted-perspectives-threads/
- Threads feed controls / Your Algo: https://about.fb.com/news/2026/06/meta-launching-new-features-500-million-monthly-threads-users/

Availability of reference features can vary by country, age, account type, and rollout stage. LuckRead must not represent a region-limited reference feature as universally available.

## 4. Existing LuckRead Baseline (Main Branch Inspection)

Inspected repository: `wanghuinet/luckread`, default branch `main`. The baseline for this closeout is `340adef1efb89c14604a5aaed7f7c3a93090e281` (2026-11-05). Settings home and notification preferences are merged; block/mute and appearance implementations exist but are still awaiting end-to-end closeout.

### 4.1 Existing APP behavior found

| Existing surface | Repository evidence | Current behavior | Contract treatment |
|---|---|---|---|
| Drawer menu | `app/app/(drawer)/_layout.tsx` | Provides a discoverable Settings & privacy entry and retains profile/account actions | Keep one settings entry; do not duplicate notification or privacy controls in the drawer |
| Settings home | `app/app/(drawer)/settings.tsx` | Groups profile, privacy, notification and appearance destinations | Reuse as the single settings index; add only routes whose API and behavior are admitted |
| Notification preferences | `app/app/(drawer)/notification-preferences.tsx`, `app/lib/notification-preferences-api.ts` | Account-level toggles for new followers, likes, comments and mentions; explicit native push permission / token synchronization and system notification settings entry | Reuse the existing screen and W01/W05/W06-backed preference API; do not fork state |
| Blocked / muted management | `app/app/(drawer)/blocked-muted.tsx`, `app/lib/block-mute-management-api.ts`, `app/lib/social-screen-api.ts` | Reads W05-owned lists through W01, paginates, resolves public profiles, and supports confirmed unblock/unmute | Reuse the existing screen/API. Close account-switch isolation, expired-session return, pagination/refresh and authenticated device checks; do not fork relationship state |
| Theme preference | `app/lib/theme-preference.ts`, `app/app/(drawer)/settings.tsx`, `app/app/_layout.tsx` | Supports light, dark and system theme; preference is stored on-device using SecureStore and selected from Settings | Reuse the three-state preference; do not create a second appearance control |
| User Center architecture | `docs/72-USER-CENTER-PROFILE-SETTINGS-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md` | Defines account, security, privacy, notifications, preferences, sessions, export and account lifecycle responsibilities | This document specializes its APP navigation and acceptance criteria; it does not replace domain ownership |

### 4.2 Important gaps from the inspected APP entry points

These are **not confirmed complete** merely because the broader User Center contract describes them:

- The unified Settings home now exists; cross-module closeout and real-device verification are still required.
- The account bottom sheet is primarily login/logout; it is not a complete account/security center.
- Notification settings currently expose four activity preferences; broader categories, quiet hours, filters, and email controls require separate capability verification.
- Theme selection exists, but the full display/accessibility/data-usage area is not established by the inspected files.
- Block/mute management exists; privacy controls such as account visibility, discoverability, message requests, reply/mention permissions, hidden words, sensitive content, and read receipts need endpoint/authority verification.
- The web app has a W01/W02 session-list and individual revoke path; native candidate work in PR #1555 is not yet admitted. Login/security history, password change, MFA/passkeys, data export, deactivation, and deletion must stay hidden until their API, security admission and runtime evidence are verified.

**Evidence rule:** code presence is not production acceptance. Each existing surface still needs source-level tests and real authenticated APP verification on the exact merged build.

## 5. Proposed Information Architecture

The Settings home should be a short, scannable index with grouped rows. Selecting a row opens a dedicated subpage; do not put every switch on one long screen.

```text
Settings & privacy
├── Account
│   ├── Account information
│   ├── Profile
│   ├── Email / phone (only where supported)
│   └── Connected sign-in methods (only where supported)
├── Security and account access
│   ├── Password and recovery
│   ├── Active sessions / devices
│   ├── Login and security history
│   └── Two-step verification (only when supported)
├── Privacy and safety
│   ├── Account / profile visibility
│   ├── Audience and post interaction permissions
│   ├── Mentions and tagging permissions
│   ├── Message requests and read receipts (when messaging is available)
│   ├── Blocked and muted accounts
│   ├── Hidden words
│   └── Sensitive-content preference
├── Notifications
│   ├── In-app / account activity preferences
│   ├── Push notification permission for this device
│   ├── Quiet hours / pause (when supported)
│   ├── Notification quality filters (when supported)
│   └── Email notifications (when supported)
├── Content and feed preferences
│   ├── Interests and followed topics
│   ├── Not interested / content controls
│   ├── Recommendation personalization
│   └── History controls (when supported)
├── Accessibility, display and language
│   ├── Appearance: light / dark / system
│   ├── Text size
│   ├── Reduced motion
│   ├── Captions and playback preferences
│   ├── Language / region
│   └── Data saver
├── Storage and data
│   ├── Media / cache usage
│   ├── Clear local cache (device-only)
│   └── Export personal data (when supported)
├── Creator and subscriptions
│   └── Link to existing Creator / subscription surfaces; do not duplicate billing state
├── Help and about
│   ├── Help center
│   ├── Report a problem
│   ├── Appeals / account status
│   ├── Terms and privacy policy
│   └── App version
└── Account actions
    ├── Log out
    ├── Deactivate account (when supported)
    └── Delete account (when supported)
```

Not every proposed row must appear in 1.0. A row is visible only when its end-to-end capability is admitted for the current release. Do not show a non-functional switch, a dead-end route, or a fake "coming soon" control as if it were an available setting.

## 6. 1.0 Scope and Release Priority

### 6.1 P0 — required for the 1.0 Settings foundation

| ID | Capability | 1.0 requirement | Initial implementation direction |
|---|---|---|---|
| SET-001 | Settings home | One discoverable home, grouped sections, consistent headers/back behavior, authenticated and logged-out states | Add the root page and wire it from the profile/avatar drawer; do not rewrite unrelated drawer navigation |
| SET-002 | Account/profile entry | Show the signed-in identity safely and link to the existing profile editor/account capability | Reuse profile and identity APIs; never show private account fields on public profile |
| SET-003 | Notification preferences | Preserve existing follow/like/comment/mention controls and clearly distinguish account preference from device OS permission | Reuse `notification-preferences.tsx` and its existing API; do not fork state |
| SET-004 | Native push permission | Show supported/unsupported, granted/denied/not-yet-requested and the appropriate system-settings action | Reuse the existing Expo Notifications registration flow; request permission only after explicit user action |
| SET-005 | Blocked and muted accounts | Reach existing paginated management screen and support safe unblock/unmute | Reuse `blocked-muted.tsx` and the Social API authority |
| SET-006 | Appearance | Light, dark and follow-system behavior; preserve current setting after relaunch | Reuse current theme preference implementation; ensure every settings subpage follows the global theme |
| SET-007 | Help and app information | Provide working help/report/policy links and visible app version/build information | Use verified destinations; no placeholder buttons |
| SET-008 | Settings states | Loading, empty, saved, retry, permission-denied, expired-session and server-error states | Apply the shared UX contract in section 12 |

### 6.2 P0 conditional controls — include only after API verification

These are important X/Threads parity controls but require a domain/API audit before they can be admitted into the 1.0 UI:

- account visibility / protected profile;
- who can follow, mention, tag, reply, quote or interact;
- message requests, who can start a conversation, read receipts, and group invitation permissions;
- hidden words / phrase filters;
- sensitive-content preference;
- notification pause/quiet hours and quality filters;
- session list and individual/all-other-session revocation;
- password/identity changes and step-up verification;
- language, text size and reduced-motion preferences;
- content-interest and recommendation controls.

For every conditional control, the implementation admission record must identify: authoritative owner, existing API path and schema, permission, persisted scope, supported clients, failure semantics, and tests. If any part is missing, hide the control from 1.0 rather than emulate it locally.

### 6.3 2.0 / later enhancements

Do not block APP 1.0 on the following advanced controls unless a separate product decision promotes them:

- time-bounded algorithm steering comparable to Threads' Your Algo;
- detailed topic-level recommendation weighting and reset/retrain workflows;
- advanced X-like personalization/ad-partner data controls unless LuckRead's ad/data-processing capabilities are live;
- full account relationship migration/import controls;
- advanced community moderation and group-management settings;
- family/supervision controls;
- federated-network settings unless federation is enabled for LuckRead;
- advanced media quality / per-network autoplay policies beyond the basic data-saver requirement.

## 7. Navigation and Interaction Contract

### 7.1 Entry points

- Primary entry: profile/avatar drawer > **Settings & privacy**.
- Secondary entry: account/profile area > settings shortcut.
- Do not add a permanent bottom-tab item for Settings.
- Notification settings and block/mute must be reachable from the central Settings hierarchy.
- Existing deep links must remain valid during migration. The existing `/notification-preferences` and `/blocked-muted` routes must either remain the canonical subpages or route safely to their new canonical locations.

### 7.2 Home page layout

Each row contains:
- a meaningful icon;
- a plain-language title;
- optional one-line description when the setting's scope is not obvious;
- a trailing chevron for navigation;
- a visible current value only when it helps the user decide.

Do not put a switch on the home page for controls that need explanation or a dedicated confirmation flow.

### 7.3 Subpage layout

- consistent top bar, back action and page title;
- related settings grouped with section labels;
- short descriptions for consequential controls;
- a clear save model: immediate save for independent toggles, explicit Save for multi-field forms;
- visible saved/failed status;
- no data loss when a save fails;
- confirmation for destructive or high-impact changes.

### 7.4 Logged-out behavior

Settings home may show only public app preferences, Help and About, and Login/Register. Account-scoped settings must require authentication and return to the intended destination after successful login. Never render another user's settings from stale cached state.

## 8. Settings Scope and Persistence

Every setting must declare one of these scopes:

| Scope | Examples | Persistence rule |
|---|---|---|
| Account-wide | notification preferences, privacy, interaction permissions, content interests | Persist through the owning domain API and sync across authenticated clients |
| Device-local | OS push permission, local cache, local download, device data saver, device-specific appearance if chosen | Persist on the device; clearly label it as this-device behavior |
| Session-specific | active session, trusted device, per-session revocation | Read/write through identity/session authority; never infer from client-local state |
| Conversation/group-specific | message requests, group invite or read receipt behavior when supported | Persist through messaging authority and make scope clear |
| Post-specific | reply approval, allowed reply/quote audience, post-level audience | Persist through the content/post authority; do not incorrectly place in global account preferences |

Do not silently switch a device-local preference into account-wide behavior or the reverse. If theme is later synced across devices, make that an explicit product decision and migrate without losing the user's current choice.

A generic settings JSON blob must not become a shortcut that bypasses domain ownership. Store each value with its owning domain and documented schema/version. The UI may aggregate these values, but the owner remains authoritative.

## 9. Domain Ownership and Architecture Constraints

The APP settings layer is a presentation/aggregation layer. It must call existing W01 API boundaries and must never access D1, Neon, R2, or another persistence service directly.

| Responsibility | Authority / boundary |
|---|---|
| APP routing, screen composition, client validation and presentation | APP client |
| Authenticated API entry and API composition | W01 existing API boundary |
| Account identity, authentication, recovery and session lifecycle | W02 identity authority |
| Content audience and post-level interaction rules | Existing Content authority (W03) |
| Follow/block/mute and social relationship controls | Social authority (W05) |
| Messaging privacy / request / group controls | Existing Messaging authority and its approved API boundary; do not couple APP settings to a database choice |
| Moderation, account restriction and appeal decisions | Governance authority (W06) |
| Notification preference and delivery semantics | Existing Notification authority; W10 executes queued work where already defined |
| Subscription and billing status | Commerce authority (W07); settings links to its canonical screen rather than copying data |
| Permission checks | W08 / server-side authorization |
| Long-running export/deletion workflow | Existing domain workflow and existing Queue/W10 path when required |
| Product usage analytics | Existing analytics authority (W11), subject to privacy policy |

Non-negotiable architecture constraints:

- no new Worker, D1 database, Queue, Service Binding, or parallel authority;
- no new database access from APP/H5/PC clients;
- no direct Neon or D1 access from settings screens;
- no Payload Core redesign or Payload user table becoming the W02 identity authority;
- no duplicate block/mute, notification, subscription, message, or content records in the User Center;
- no new generic settings service unless an approved architecture review proves the existing domain APIs cannot satisfy the contract;
- existing Queue and Service Bindings are reused for asynchronous work;
- server-side authorization remains authoritative even when a setting is hidden or disabled in the client.

## 10. Security, Privacy and Trust Requirements

- Sensitive operations (password, email/phone, identity provider, session revocation, deactivation, deletion) require recent authentication or step-up verification according to the existing security policy.
- Session revocation must be enforced server-side and take effect promptly; removing a row from the APP is not sufficient.
- Never store authentication secrets, recovery codes or access tokens in ordinary preference storage.
- Do not log passwords, push tokens, private message content, recovery material, or sensitive preference payloads.
- Never expose internal fraud/risk scores, moderation evidence, detection rules, or private security metadata.
- Do not allow privacy preferences to bypass legal requirements, user safety, block state, account restrictions or rights controls.
- A push permission denial at OS level is not equivalent to disabling account-level notification preferences.
- Marketing notification consent must remain separate from security/transactional notifications.
- Destructive account actions need consequence explanation, explicit confirmation, idempotency, audit and a recoverable status model.
- Settings data must be isolated by authenticated account; account switching must clear account-scoped cache before rendering the next user's settings.

## 11. API and Event Contract

This document does not authorize invented endpoints or client-side persistence substitutes.

Before implementing a control, record:

1. the canonical existing API operation and version;
2. the owning domain and resource;
3. authenticated actor and required permission;
4. request/response schema and validation;
5. persistence scope (account/device/session/conversation/post);
6. idempotency and concurrency behavior;
7. cache invalidation or revalidation behavior;
8. event/queue side effects, if any;
9. error codes and safe retry behavior;
10. tests and deployed runtime evidence.

Use existing API inventory and contract tests. The endpoint examples in the related User Center contract are architectural recommendations, not proof that every route has shipped.

For changes that emit events, use the existing versioned platform envelope and idempotent consumers. A simple settings toggle must not introduce unnecessary high-volume events or synchronous fan-out.

## 12. UX State and Error Contract

Every settings page and mutation must define:

| State | Required behavior |
|---|---|
| Initial loading | Skeleton or compact progress state; avoid blank page |
| Saved | Clear confirmation or current saved value |
| Saving | Prevent duplicate submissions; keep the pending value visible |
| Save failure | Explain failure, retain user's intended value, provide retry; do not claim saved |
| Offline / timeout | Preserve local form edits and retry safely |
| Expired session | Explain sign-in is required and return to the original settings route after login |
| Permission denied | Explain whether the restriction is from OS permission, account permission or server policy |
| Unsupported platform | Explain the limitation or hide the device-only option; never present a nonfunctional control |
| Empty list | Explain why it is empty and provide the relevant next step |
| Restricted account | Show the allowed actions and appeal/support entry without exposing internal risk logic |
| Destructive action | Explain consequences, require confirmation and show the authoritative operation status |

Independent switches may save immediately only when the API has clear idempotent semantics. On failure, restore the server-confirmed value or clearly retain a retryable pending state. Never leave a switch visually enabled after a failed write while implying the server accepted it.

## 13. Visual, Accessibility and Performance Requirements

- Preserve LuckRead's design tokens and visual identity; do not reproduce X or Threads logos, iconography, exact copy or proprietary assets.
- Match the platform's native interaction expectations for Android and iOS.
- Maintain full light/dark/system coverage across the Settings home, all subpages, modal sheets, loading, errors and confirmation dialogs.
- Support screen readers with meaningful labels, roles, selected/disabled states and logical focus order.
- Minimum touch target: 44x44 pt on iOS and an equivalent comfortable Android target.
- Text scaling must not clip titles, switch labels, buttons or error messages.
- Do not use color alone to communicate state.
- Respect reduced motion where supported.
- Respect safe-area insets, keyboard visibility, back gestures and Android system back.
- Avoid blocking navigation while an unrelated setting is saving.
- Do not make the whole Settings home depend on slow fan-out requests. Load the shell first and fetch each section only when needed.
- Preserve scroll position when returning from a subpage.
- Use pagination for long block/mute or session lists.
- Device-local cache clearing must never be presented as deletion of server-side account data.

## 14. Telemetry and Observability

Measure settings quality, not engagement manipulation:

- Settings home open and destination selection;
- completion rate for each settings task;
- settings read/write API latency and failure rate;
- save retry rate and duplicate submission prevention;
- permission-prompt acceptance/denial;
- login return-to-settings success;
- accessibility defects reported;
- account switching/cache leakage incidents (target zero).

Do not collect raw private preference values or message privacy details as analytics payloads. Use minimal event names and non-sensitive result categories.

## 15. Acceptance Matrix

A setting is not DONE because the screen renders. Each applicable row must pass:

| Gate | Acceptance |
|---|---|
| Navigation | Entry is discoverable; back and deep-link behavior work; no dead-end route |
| Authority | Read/write reaches the owning domain through W01; no client DB access |
| Correctness | Reloading the screen shows server-confirmed state |
| Failure | Offline, 401, 403, timeout, validation and 5xx behavior is recoverable |
| Security | Cross-account isolation and permission checks are verified |
| Accessibility | Screen-reader, touch target, font scale, contrast and focus are verified |
| Theme | Light, dark and system modes are correct across all screen states |
| Platform | Android and iOS behavior is checked; unsupported web behavior is explicit |
| Reliability | Duplicate taps/retries do not duplicate or corrupt mutations |
| Runtime | Exact merged build is tested with a real authenticated account and device |

### 15.1 Minimum 1.0 end-to-end scenarios

1. Open avatar menu > Settings & privacy > open and return from every visible section.
2. Change each notification activity preference, leave the page, reopen it, and verify server-persisted state.
3. Deny OS push permission, verify account notification preferences remain distinct, and open system settings from the APP.
4. Grant push permission explicitly and verify the existing installation/token registration path without prompting on app launch.
5. Open Blocked and muted, paginate, unblock/unmute, refresh and verify authoritative state.
6. Change light/dark/system appearance, navigate through every settings page, background/relaunch the APP and verify consistency.
7. Open Settings while logged out, sign in, and return to the exact intended page.
8. Switch accounts and verify no previous account's settings appear, even briefly.
9. Simulate offline/timeout/401/403/5xx during reads and writes; verify clear errors and safe recovery.
10. Verify no visible 1.0 setting is a nonfunctional placeholder.

### 15.2 Conditional settings acceptance

For every conditional feature admitted into 1.0, add positive, negative, permission, persistence, cross-device and failure tests specific to that feature. A UI test alone is insufficient for a security or privacy setting.

## 16. Implementation Sequence (One Module per Round)

Implementation must proceed in small, reviewable increments. Complete and verify one module, stop, report evidence and remaining work, and wait for the next instruction.

| Step | Module | Current status | Exit condition |
|---|---|---|---|
| 0 | Read-only implementation inventory | DONE — existing contract/inventory | Exact route/API/test/owner matrix exists; no code change |
| 1 | Settings home and navigation | IMPLEMENTED — PR #1553 merged | One discoverable root; existing routes continue to work |
| 2 | Notification preferences integration | IMPLEMENTED — PR #1554 merged | Four account preferences and OS push permission use the existing server/device paths |
| 3 | Blocked and muted integration | WAITING FOR CLOSEOUT — existing implementation; account-scope and expired-session fixes in this PR | Real-account pagination, unblock/unmute persistence, error recovery, account switching, accessibility and Android/iOS verification are complete |
| 4 | Appearance settings integration | WAITING FOR CLOSEOUT — light/dark/system implementation is present | Relaunch persistence and theme consistency across every Settings subpage, modal, loading/error state and Android/iOS are verified |
| 5 | Account and session security | WAITING FOR ADMISSION — PR #1555 is a candidate implementation, not admitted | Security/API/permission admission and authenticated Android/iOS runtime evidence are accepted before merge/release; password, MFA/passkeys, login history and bulk revocation remain hidden |
| 6 | Privacy controls | WAITING FOR ADMISSION | Each candidate control has a proven W03/W05/Messaging owner, existing API/schema, permission, persistence, cross-client behavior and negative/security tests before UI exposure |
| 7 | Content preferences and data controls | NOT IMPLEMENTED | Only supported server-owned preferences and clearly device-local controls are implemented; no fake settings or generic settings authority |
| 8 | Help, about and final polish | NOT IMPLEMENTED | Verified help/policy/report destinations, real app version/build, accessibility and all settings release gates pass |

Do not batch unrelated modules. Do not start Step 2 in the same round as Step 1. Stop immediately after each module reaches its own exit condition.

## 17. Definition of Done

The APP Settings 1.0 baseline is complete only when:

- the unified Settings home is discoverable and every visible row has a real destination;
- the existing notification, block/mute and appearance behavior has been integrated rather than duplicated;
- every visible server-backed control reads and writes the authoritative domain;
- device-level and account-level preferences are clearly distinguished;
- security/privacy controls are server-enforced and have safe failure/recovery behavior;
- Android and iOS accessibility, theme, safe-area and navigation behavior pass;
- all 1.0 E2E scenarios pass on the exact merged build;
- no 2.0-only feature is required for the 1.0 release gate;
- evidence is attached to the exact commit/build tested.

**Current contract status: STEPS 0–2 IMPLEMENTED / STEPS 3–4 WAITING FOR CLOSEOUT / STEPS 5–6 WAITING FOR ADMISSION / STEPS 7–8 NOT IMPLEMENTED.**  
Step 3 already has its W05-backed APP screen and API adapter; this PR closes account-switch data isolation, expired-session routing, and request/loading-state races. Automated CI and real authenticated Android/iOS verification are still required before Step 3 can be closed. Step 4 remains open pending full relaunch/theme-consistency checks. PR #1555 remains an unadmitted Step 5 candidate and must not merge or expose its settings entry until the security/API admission and real-device evidence are accepted. Proceed one module at a time.
