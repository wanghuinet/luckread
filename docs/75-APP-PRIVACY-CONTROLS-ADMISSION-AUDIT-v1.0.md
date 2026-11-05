# APP Settings & Privacy Center — Step 6 Admission Audit v1.0

**Audit date:** 2026-11-05  
**Repository:** `wanghuinet/luckread`  
**Audited base:** `main @ 340adef1efb89c14604a5aaed7f7c3a93090e281`  
**Module:** Settings & Privacy Center — Step 6, Privacy controls admission  
**Decision:** `BLOCKED_NOT_ADMITTED`  
**Release target:** APP 1.0

## 1. Executive decision

Do not add account-wide privacy switches to the native Settings screen yet.

The current main branch has working, server-owned **block/mute relationships** and **per-post reply-audience policies**. It does not currently provide an admitted account-wide privacy preference API for protected profiles, follow approval, discoverability, mention permissions, message requests/read receipts, hidden words, or sensitive-content filtering.

A local APP toggle cannot safely stand in for any of those controls. It would misrepresent the saved state and, for profile visibility in particular, could create a false privacy guarantee while the existing public profile reader still returns a public projection and other content read paths have not been proven to enforce that new setting.

This audit is a readiness/admission record, not an implementation claim. No new UI control, API route, database table, or privacy behavior is introduced by this change.

## 2. Verified existing capabilities

| Capability | Existing implementation | Scope and decision |
|---|---|---|
| Block and mute | W01 interaction routes; W05 `block-mute-runtime.ts`; W05-owned `social_user_interactions`; native `blocked-muted.tsx` | Account-to-account relationship controls already integrated by Settings Step 3. Keep as-is; do not duplicate state in a new privacy store. |
| Reply audience | W01 `/v1/contents/{contentId}/reply-audience`; W05 `reply-audience-runtime.ts`; `social_content_reply_policies` migration | **Post-specific** policy, keyed by `content_id`, controlled by the post owner. Five values are supported: `everyone`, `verified`, `following`, `mentioned`, `followingNetwork`. It belongs in the composer/post editor, not in account-wide Settings. |
| Public profile projection | W01 `users/[userId]` route and `public-user-profile-reader.ts` | Public profile projection currently returns public identity/profile fields; no viewer-specific protected-profile policy is applied here. |
| Self profile edit | W01 `(payload)/api/users/me/route.ts`, `user-profile-etag.ts`, and `Users.ts` | PATCH only accepts `displayName`, `bio`, `avatar`, `locale`, and `timezone`. No account visibility/privacy field is part of this profile DTO or Users schema. |
| Follow graph | W01 `social/follows/{targetUserId}`; W05 `follow-runtime.ts`; `social_follow_relationships` migration | Direct follow/unfollow relationship only. The current relation schema has no pending-request state or request-approval lifecycle. |

## 3. Conditional feature admission matrix

| Candidate control | Required owner / enforcement | Evidence found on main | Admission |
|---|---|---|---|
| Protected/private profile | A confirmed policy owner plus enforcement on every public profile, content, feed, search, share/preview and cache path | No account visibility field, no policy read/write route, no pending follow-request state, and public profile projection does not consult a protected-profile policy | **Blocked — do not expose** |
| Follow approval / incoming requests | W05 social relationship authority, W01 API, W08 self-scope permission, notification side effects and idempotent accept/reject operations | Existing follow relation is direct; no request resource or accept/reject route found | **Blocked — do not expose** |
| Who can mention/tag me | A durable account preference and W05 enforcement before mention notification/interaction effects | W01 currently resolves mentioned identities from post text for a post-level reply allowlist; no account-wide mention policy exists | **Blocked — do not expose** |
| Who can contact me / message requests | Existing Messaging authority and approved API contract, including conversation creation and request state | No admitted Messaging privacy read/write contract was found in the audited W01/W03/W05 settings boundaries | **Blocked — do not expose** |
| Read receipts | Messaging authority, per-account or per-conversation semantics, and server-enforced delivery/read behavior | No admitted setting or runtime contract found | **Blocked — do not expose** |
| Hidden words / phrase filters | Explicit account/device scope, durable store, and consistent feed/search/notification filtering semantics | No admitted preference API or runtime filter was found | **Blocked — do not expose** |
| Sensitive-content preference | Safety-policy owner and server/read-path enforcement, with clear policy precedence | No admitted setting/read path found | **Blocked — do not expose** |
| Global default reply audience | W05 policy owner, account-level setting contract and an explicit default-vs-post-override rule | Existing API requires a `contentId`; persisted policy is keyed by post | **Not supported as an account setting** |

## 4. Why a UI-only private-profile switch is unsafe

The current public profile read path is:

`GET /v1/users/{userId}` → W01 `getPublicUserProfileResponse` → public response cache → public profile projection.

That projection is not gated by an account visibility preference. Meanwhile, the current follow path writes a direct `social_follow_relationships` relationship; it has no `PENDING` state.

Therefore, adding a client-side "private account" switch alone would not:
- prevent the existing public profile reader from returning its public projection to non-approved viewers, or prove that every other content read surface enforces that new policy;
- prevent cached profile/content responses from being served;
- convert a follow action into a request awaiting approval;
- protect profile content across feeds, search, shares, links, or secondary read paths.

Do not ship a setting whose label promises privacy that the server does not enforce.

## 5. Required implementation contract before Protected Profile can be admitted

Protected Profile is the strongest account-level privacy foundation for a future X/Threads-like experience. It may be considered as a separate backend-first module only after the following contract is settled:

1. **Authority:** explicitly assign policy ownership and define the W05 social-graph / W03 content-read enforcement boundary. APP and H5/PC remain W01 API clients only.
2. **Persistence:** use an approved existing database binding (no new D1); define schema, migration, ownership, default behavior, rollback and data-retention semantics. Do not add a generic settings JSON blob.
3. **Follow lifecycle:** define `not_following`, `requested`, `following` states, idempotent request creation, request cancellation, owner-only accept/reject, duplicate handling, and follower-count/notification semantics.
4. **Authorization:** enforce self-read/self-update and request-owner decisions server-side using the approved W08 permission model. Cross-account resource probing must not reveal private relationship state.
5. **Read enforcement:** inventory and protect every public read surface before exposing the setting: profile, posts/articles/media, replies/likes as appropriate, feed, search, user lookup, content links/metadata, share previews, and cached responses.
6. **Cache correctness:** invalidate or revalidate public profile/content/feed caches on visibility changes, follow-request decisions and relationship transitions. Authorization must run before a cache hit can disclose protected data.
7. **Cross-domain behavior:** preserve W03 content authority, W05 relationship authority, existing Queue/W10 async behavior and notification contracts; do not create a parallel identity or content store.
8. **Tests:** cover anonymous, non-follower, pending requester, approved follower, blocked pair, owner, suspended/restricted account, cache warm/cold, pagination, stale request, duplicate mutation and account-switch cases.
9. **Three-client contract:** document and verify APP, H5 and PC behavior through W01 APIs before release.
10. **Operations:** provide migration admission, rollback evidence, rate-limit/idempotency coverage and a real two-account runtime test.

Only after all the above are implemented and admitted may the native Settings UI show an account-visibility switch.

## 6. Step 6 execution decision

- Keep the existing Settings > Privacy & safety > Blocked and muted destination.
- Keep per-post reply-audience controls in the post composer/editor; do not duplicate them in Settings.
- Do not show placeholder rows or local-only toggles for the blocked candidate controls in section 3.
- Keep Step 6 marked **BLOCKED_NOT_ADMITTED** until a concrete server-owned privacy feature has completed its own backend, API, authorization and read-path implementation.
- Continue the Settings roadmap's later modules only when their own prerequisites are satisfied; this audit does not authorize Step 7 or Step 8 scope changes.

## 7. Evidence paths inspected

- `app/app/(drawer)/settings.tsx`
- `workers/W01-payload/src/app/(payload)/api/users/me/route.ts`
- `workers/W01-payload/src/auth/user-profile-etag.ts`
- `workers/W01-payload/src/collections/Users.ts`
- `workers/W01-payload/src/users/public-user-profile-reader.ts`
- `workers/W01-payload/src/app/api/v1/users/[userId]/route.ts`
- `workers/W01-payload/src/app/api/v1/social/follows/[targetUserId]/route.ts`
- `workers/W01-payload/src/app/api/v1/contents/[contentId]/reply-audience/route.ts`
- `workers/W05-social/src/follow-runtime.ts`
- `workers/W05-social/src/reply-audience-runtime.ts`
- `workers/W05-social/src/block-mute-runtime.ts`
- `workers/W05-social/migrations/20260930_001_social_001_follow_v1.sql`
- `workers/W05-social/migrations/20261019_015_social_reply_audience_v1.sql`
- `docs/72-USER-CENTER-PROFILE-SETTINGS-AND-ACCOUNT-LIFECYCLE-CONTRACT-v1.0.md`
- `docs/73-APP-SETTINGS-PRIVACY-CENTER-CONTRACT-v1.0.md`

**Final status:** Step 6 privacy-control admission is not complete. The audit found no safe account-wide control to expose using only the current admitted APIs. This result is intentional fail-closed behavior, not a claim that privacy controls have shipped.
