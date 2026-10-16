# LuckRead v1.2 — X App Frontend Reuse & Social Foundation Contract

Status: DRAFT / PHASE-1-ONLY / NOT-IMPLEMENTATION-AUTHORIZATION

## 1. Purpose and authority

This contract defines a staged migration of LuckRead's frontend toward the interaction patterns and responsive presentation of X App / X Web by reusing authorized upstream frontend code. LuckRead's current backend remains authoritative.

This file does not claim that any feature is complete. A feature is complete only after code, tests, real API behavior, authorization behavior, and deployed UI have been verified.

## 2. Non-negotiable boundaries

- Preserve the current LuckRead backend, API contracts, authentication, authorization, data ownership, Worker boundaries, and existing persistence.
- Do not replace LuckRead APIs or data authority with an upstream project's Firebase, Firestore, authentication, storage, or mutation implementation.
- Reuse existing LuckRead APIs first. A missing capability must be evidenced before proposing a minimal backend change; do not invent endpoints or silently weaken permissions.
- Do not introduce duplicate business tables, duplicated post bodies for reposts, redundant Workers, or parallel sources of truth.
- Do not begin broad frontend implementation during Phase 1. Phase 1 authorizes inventory and this contract only.

## 3. Frontend reuse and CSS policy

**CSS must not be independently designed or authored. Reuse is the default and required path.**

1. Reuse existing LuckRead styles and components where already aligned.
2. Prefer copying/adapting complete components, source stylesheets, markup structure, responsive behavior, and interaction patterns from the four user-authorized repositories.
3. Keep source class names, layout structure, breakpoints, and original style conventions where feasible. Avoid rebuilding the same UI from scratch.
4. Do not add decorative CSS, a new design system, or layers of override CSS to approximate the source.
5. When conflicts occur, prefer source component isolation, existing tokens, and existing project compatibility mechanisms. Document any unavoidable deviation before implementation.
6. Search all four authorized repositories before concluding that a component is unavailable. Do not expand the authorization scope or substitute an unapproved repository without user approval.
7. Preserve applicable upstream license and attribution notices with copied or substantial portions of source code.
8. For every migrated component, record source repository and path, destination path, dependencies/styles copied, and the minimum integration changes.
9. If a feature cannot be achieved through authorized source reuse, stop at an evidenced gap and request a decision; do not treat the no-self-authored-CSS rule as optional.

## 4. Authorized source registry

The user has explicitly confirmed that all four repositories below are authorized reuse sources:

| Source | Initial repository evidence | Reuse focus / constraint |
|---|---|---|
| [jokerhutt/x-clone](https://github.com/jokerhutt/x-clone) | README describes React + TypeScript + Tailwind; image/video uploads, feed, search, notifications, bookmarks and retweets. Repository metadata does not identify a license; no root LICENSE file was found in this initial check. README says the project is strictly non-commercial. | Inspect UI/media patterns and confirm written permission scope covers intended use and distribution; do not import its JWT/Google OAuth/backend/storage implementation. |
| [MkdirRaiden/twitter-clone-client](https://github.com/MkdirRaiden/twitter-clone-client) | README describes React + Vite + Tailwind + React Query; auth UI, search, follow system, interactions, notifications and responsive UI. Repository metadata does not identify a license; no root LICENSE file was found in this initial check. | Inspect components/styles for reusable UI patterns; do not use its external backend/auth or assume unlicensed code has blanket reuse rights beyond the user's explicit permission. |
| [Nash2610/X-Clone](https://github.com/Nash2610/X-Clone) | GitHub metadata identifies MIT; root LICENSE file exists. README describes responsive X-like UI, search and interactions; package manifest indicates a lightweight Vite/Tailwind app. | Inspect static UI/layout patterns; preserve MIT notice and verify source paths and practical integration value before copying. |
| [ccrsxx/twitter-clone](https://github.com/ccrsxx/twitter-clone) | GitHub metadata identifies MIT; existing LuckRead third-party notices identify reused tweet, profile, sidebar, feed and style patterns. Upstream is archived and uses Firebase/Firestore. | Primary existing reference for X-like layout and interactions; reuse presentation only, not Firebase/Firestore/auth/storage or mutation logic. Preserve MIT attribution. |

The user's authorization establishes the allowed repository list. It does not remove the need to preserve applicable license notices or to distinguish explicit permission from an upstream repository's default license. For the first two repositories, repository metadata currently reports no license and no root LICENSE file was found; record the user's permission and its scope in the project evidence rather than treating the repositories as MIT-licensed.

Before copying from any source, record the exact source file/path, destination path, applicable license/permission evidence, copied styles/dependencies, and minimum adaptation. Do not import upstream backend/auth/data-authority implementations.

## 5. Social foundation scope

Each item below must be classified from the actual codebase as verified-complete, partial, missing, broken, or blocked. The list is not evidence of implementation.

### 5.1 Post creation and media
- Text post creation, validation, submission state, success/error feedback, and timeline refresh.
- Image selection/upload, multi-image presentation, preview and upload failure handling.
- Short-video selection/upload, preview, playback and failure handling.
- Poll creation, option editing, voting, results and duplicate-vote handling according to existing backend rules.
- Compose modal behavior aligned with the reference implementation, including responsive behavior and keyboard/scroll handling.
- No additional human approval step for ordinary post publishing unless an existing mandatory policy explicitly requires it.
- Investigate the reported `Permission denied` publishing failure through request, session, permission and server evidence. Never fix it by disabling authorization or broadening access indiscriminately.

### 5.2 Timeline and post interactions
- Home and following timelines, pagination/loading/empty/error states.
- Post card, detail, media rendering and reply thread.
- Reply/comment creation and nested discussion presentation.
- Like/unlike, repost/unrepost, pin/unpin post.
- Correct counters and state synchronization after successful mutations.
- Reposts should use a relationship/reference model where supported, not duplicate the original post body.

### 5.3 Profile and relationships
- Profile display and editing, avatar/header presentation and profile tabs.
- Follow/unfollow, followers and following lists, following timeline.
- Respect current block, visibility and relationship rules.

### 5.4 Supporting social surfaces
- Notifications and interaction alerts.
- Search entry/results using existing available capabilities.
- Report content, block/mute or visibility controls where supported by current backend.
- Share/copy-link interactions.
- Accessible loading, empty, failure, unauthorized and signed-out states.

## 6. API, identity and permission mapping

For each feature, the inventory must identify:
- Route/page and user-visible entry point.
- Reused source repository and exact source file(s).
- Existing LuckRead API operation/path and request/response DTO, verified from code or API contract.
- Authentication mechanism and authorization authority.
- Read/write owner, persistence behavior and side effects.
- Loading, empty, success, failure and permission-denied states.
- Tests and manual/end-to-end acceptance evidence.
- Any backend gap, with evidence and the minimum proposed change.
- Current status: verified-complete / partial / missing / broken / blocked.

Unknown API names, DTO fields, permissions or database behavior must be explicitly marked unverified; do not infer or invent them.

## 7. Initial evidence-based inventory (2026-10-16)

This is a repository/PR evidence snapshot, not a claim of full runtime acceptance. Merge status proves code landed; it does not by itself prove the production user journey works.

### 7.1 Current PR deduplication

| Status | PR | Finding / action |
|---|---|---|
| Open | [#1063](https://github.com/wanghuinet/luckread/pull/1063) | This contract and reuse boundaries. |
| Open | [#1064](https://github.com/wanghuinet/luckread/pull/1064) | Fixes ordinary-post permission, direct publish after W03 preflight, and the composer preflight adapter path. Do not merge until all CI gates pass; latest checks are being rerun after fixing a stale lifecycle assertion and an impossible TypeScript moderator comparison. |
| Merged | [#1042](https://github.com/wanghuinet/luckread/pull/1042) | Shared social post card adapted from ccrsxx; uses LuckRead W01/W05 APIs and preserves attribution. |
| Merged | [#1043](https://github.com/wanghuinet/luckread/pull/1043) | Threaded discussion presentation wired to W05 comments. |
| Merged | [#1044](https://github.com/wanghuinet/luckread/pull/1044) | Reused profile header and navigation. |
| Merged | [#1046](https://github.com/wanghuinet/luckread/pull/1046) | Follow-list row using W05 data. |
| Merged | [#1047](https://github.com/wanghuinet/luckread/pull/1047) | Shared post card on public profiles. |
| Merged | [#1048](https://github.com/wanghuinet/luckread/pull/1048) | Share and bookmark actions. |
| Merged | [#1053](https://github.com/wanghuinet/luckread/pull/1053), [#1056](https://github.com/wanghuinet/luckread/pull/1056) | Following tab and authenticated Following feed. |
| Merged | [#1054](https://github.com/wanghuinet/luckread/pull/1054), [#1055](https://github.com/wanghuinet/luckread/pull/1055), [#1057](https://github.com/wanghuinet/luckread/pull/1057) | Report action, paginated bookmarks, post more-actions menu. |
| Merged | [#1058](https://github.com/wanghuinet/luckread/pull/1058), [#1059](https://github.com/wanghuinet/luckread/pull/1059) | Profile content tabs; repost and pinned-post actions. |
| Merged | [#1060](https://github.com/wanghuinet/luckread/pull/1060), [#1061](https://github.com/wanghuinet/luckread/pull/1061), [#1062](https://github.com/wanghuinet/luckread/pull/1062) | Home compose routing, clone-style compose modal, and X-like timeline card presentation. Runtime publish permission is handled separately by open PR #1064. |
| Closed unmerged | [#1051](https://github.com/wanghuinet/luckread/pull/1051), [#1052](https://github.com/wanghuinet/luckread/pull/1052) | Do not revive as duplicate standalone work without new evidence; following-feed implementation was subsequently merged in #1056 and tab wiring in #1053. |
| Closed unmerged | [#1049](https://github.com/wanghuinet/luckread/pull/1049) | Migration route-check repair was not merged separately; use the merged migration and verify current route behavior rather than reapplying this branch. |

### 7.2 Source-to-destination reuse map (verified paths only)

| Reused presentation | Upstream source evidence | LuckRead destination / current evidence |
|---|---|---|
| Social post card, post stats and user-card composition | ccrsxx/twitter-clone Tweet, TweetStats, user-card presentation | workers/W01-payload/src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx; merged PR #1042 |
| Profile header/avatar/details and profile tab navigation | ccrsxx/twitter-clone src/components/layout/user-home-layout.tsx, src/components/user/user-home-avatar.tsx, src/components/user/user-details.tsx, src/components/user/user-nav.tsx | workers/W01-payload/src/app/(frontend)/users/[userId]/TwitterCloneProfileHeader.tsx and TwitterCloneProfileNav.tsx; merged PR #1044 |
| Composer modal / home timeline presentation | ccrsxx/twitter-clone is the established presentation reference; exact per-component source paths still require final source-level verification | workers/W01-payload/src/app/(frontend)/publish/PublishComposer.tsx and shared home feed/card; PRs #1061/#1062 |
| Image/video upload presentation | Existing LuckRead composer includes a multi-file media input accepting images and videos (articles accept images); current code has media preview/removal and video metadata UI | Same PublishComposer.tsx; verify deployed upload and publication round trip. This does not yet establish X-style icon placement or complete E2E acceptance. |

The three additional authorized repositories are in the allowlist, but their exact component paths have not yet been selected/copied into LuckRead. Do not fabricate a source-to-destination mapping; finish file-level comparison before choosing any component from them.

### 7.3 Feature/API/permission/test status

| Feature | Current status | Existing authority / evidence | Remaining closeout |
|---|---|---|---|
| Ordinary text post publishing | **Broken / pending fix validation** | W03 content authority; W01 composer; open PR #1064 | Pass all CI, verify L2-L4 ownership rules, W03 preflight, public feed appearance and real success/error response. |
| Human review for ordinary posts | **Pending fix validation** | #1064 narrowly permits owner-only DRAFT -> PUBLISHED for posts; articles/videos retain review | Confirm deployed runtime behavior; no blanket review bypass. |
| Image and video selection/upload UI | **Partial / code present** | Existing PublishComposer.tsx, LuckRead media API; image/video file input and previews | Confirm upload API/auth, file constraints, upload failure, save/reload and published post rendering on desktop/H5. |
| Poll creation and voting | **Missing / blocked on API contract evidence** | Current PR #1064 explicitly excludes polls; no dedicated SOCIAL-008 poll/vote contract/API evidence found in the current inventory | Search all four authorized sources for reusable poll UI; separately verify whether LuckRead has canonical poll/vote APIs. Do not implement frontend-only fake polls or create a second data authority. |
| Like, reply/thread, repost, pin | **Code present; runtime acceptance still required** | #1042, #1043, #1059; W05 is social authority | Verify counts, idempotency, ownership and refreshed state in live journeys. |
| Following timeline, profile tabs, report, bookmark/share | **Code present; runtime acceptance still required** | #1044, #1048, #1053–#1058; existing W01/W05 adapters | Avoid reimplementation; verify empty/error/auth states and real API behavior. |
| Notifications, search, block/mute | **Partial / needs surface-by-surface verification** | Existing backend capabilities and prior profile surfaces vary by feature | Map exact route, API, permission, source component and acceptance evidence before declaring complete. |

## 8. Staged delivery

### Phase 1 — Contract and inventory (current authorized phase)
- Review current frontend, API contracts, route structure, social adapters and existing implementation evidence.
- Review open, merged and closed PRs for reusable work and duplicate implementation risks.
- Recover and verify the exact four-repository allowlist and its authorization scope.
- Map source components/styles to LuckRead destination files.
- Produce the feature-to-API/permission/test matrix and a list of verified gaps.
- Add this contract and submit it as a standalone PR.
- Do not start broad implementation in this phase.

### Phase 2 — Post publishing
- First diagnose and fix the actual `Permission denied` publishing defect.
- Reuse the reference compose modal and its original styles/interaction structure.
- Close the text, image, short-video and poll publishing flows against existing LuckRead APIs.
- Verify ordinary posts publish without a new human review step, subject to existing rules.

### Phase 3 — Timeline and interactions
- Close timeline, post details, reply tree, likes, reposts and pin/unpin.
- Reuse existing implementation and PRs; do not recreate already verified functionality.

### Phase 4 — Profiles and relationships
- Close profile pages, profile tabs, follow/unfollow, followers/following and following timeline.

### Phase 5 — Supporting social surfaces
- Close notifications, search, reporting, blocking/visibility and sharing where backend capabilities exist.

### Phase 6 — Responsive and end-to-end acceptance
- Verify desktop and H5/mobile layouts against the reference.
- Verify actual API requests, session/permission boundaries, media/poll flows and state updates.
- Deploy through the existing workflow and inspect the real deployed pages.
- Record remaining gaps honestly.

Phase order may be adjusted only where verified dependencies require it. Features already verified complete must not be reimplemented.

## 9. Acceptance gates

A phase is accepted only when:
- Source reuse and attribution are traceable.
- No unauthorized repository code was copied.
- No new self-authored CSS was introduced.
- Existing API and authorization boundaries remain intact.
- Relevant type/build/test checks pass, and actual interaction tests support the claimed result.
- Failure and permission cases are exercised where relevant.
- PR and deployment evidence are linked in the handoff.

Build success alone is not end-to-end acceptance. A written plan alone is not feature completion.

## 10. Phase-1 exit report

The Phase-1 PR must include:
1. Contract path and concise change summary.
2. Exact four authorized repositories and authorization evidence, or a clearly marked blocker for any unverified entry.
3. Existing feature status and open/merged/closed PR deduplication findings.
4. Source-to-destination reuse map.
5. Feature/API/permission/test matrix and evidence-backed gaps.
6. Tests/checks performed and not performed.
7. Explicit confirmation that broad feature implementation has not started.

After the contract PR is opened, pause for review and report the PR URL. Do not merge the contract or start Phase 2 without the next instruction.
