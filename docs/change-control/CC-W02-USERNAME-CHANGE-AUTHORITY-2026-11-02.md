# Change Control — W02 Username Change Authority

- ID: CC-W02-USERNAME-CHANGE-AUTHORITY-2026-11-02
- Scope: W02 / Better Auth / D1-01 username authority only
- Base: `1605e8d73db5d0fe47520ef3e6cbd823be4c0856`
- Status: OWNER_POLICY_DECISIONS_CAPTURED / IMPLEMENTATION_CANDIDATE
- No production migration, Worker deployment, PR merge, or W01 public API activation is authorized by this record.

## Owner decisions

1. A successful username change has a 30-day cooldown.
2. The previous username is reserved for 30 days only and becomes reusable after expiry.
3. A 301 redirect is valid for 30 days only.
4. A redirect is created only when W03 confirms that the account already has at least one publicly published post, article, video, or short.
5. A brand-new/empty account with no published public content does not create a Payload redirect record.
6. The initial exact reserved-name list is delegated to the implementation owner and lives in `contracts/security/username-reservation-policy.v1.json`.

## Reserved-name policy

Matching is exact after trim → Unicode NFC → casefold. Accepted usernames remain ASCII alphanumeric, 6–32 characters, consistent with the active W01 registration validator. Therefore ASCII lowercase is equivalent to casefold for accepted values. No broad prefix or suffix reservation is applied. Unicode confusables are rejected by the character allowlist.

## W02 authority and lightweight persistence

- Better Auth's live session is the only actor/subject source; the endpoint can only change that session's own account.
- Better Auth `user.username` remains the current username authority.
- Existing `auth_identities.username_normalized` is synchronized by a D1 trigger in the same transaction.
- W02 stores one compact `auth_username_change_state` row per account that has renamed: monotonic version, last successful change time, one previous handle with a 30-day expiry, and a 24-hour idempotency receipt.
- W02 does not store a permanent username alias log and does not create 301 documents.
- The database reservation guard also covers Better Auth registration/update writes, so a previous handle cannot be reclaimed inside the 30-day window through another entry point.
- After expiry, the previous handle is no longer reserved; subsequent changes overwrite the one prior-handle slot.
- Display name and Better Auth `user.name` are not changed.
- Mutations require `Idempotency-Key` and the W02 username ETag in `If-Match`.
- Existing W02 rate-limit namespaces are reused; no Worker, D1, Queue, Service Binding or limiter namespace is added.

## Redirect ownership and eligibility

- The official Payload `@payloadcms/plugin-redirects` remains the W01 redirect storage/admin implementation.
- W01 creates a redirect only after the W03 authority confirms at least one existing publicly published post/article/video/short for the identity.
- Draft, scheduled, private, unlisted, deleted, removed and moderation-blocked content do not qualify.
- A redirect is 301 for 30 days from the successful rename. It is never extended when a later rename changes its destination; still-active records may be flattened to the latest username while preserving their original expiry.
- The complete route suffix and query string are preserved; only the username segment changes.
- Resolver and middleware must not cache beyond expiry; 301 responses use no-store.
- A previous username that expires must stop resolving and become eligible for reuse. W01 registration/admin checks must ignore expired redirect records.
- These W01/W03 eligibility and expiry behaviors belong to the separate event/projection and redirect integration modules, not this W02 authoritative write slice.

## Boundaries and deferred integrations

- This slice adds private W01-service-bound W02 state/change endpoints only.
- W01 public `PATCH /users/me/username`, removal of username from generic profile PATCH, W02-to-W01 projection/event consumption, W03 published-content eligibility read, and Payload resolver expiry checks remain follow-up modules.
- PR #1481 remains independent and must not be merged/deployed until these policy rules are implemented and its W01 migration admission is complete.
- AUTH-003 credential-management APIs remain blocked. This slice does not write credential hashes or alter `auth_credentials`; an active username credential collision belonging to another user is rejected.
- Username-specific step-up thresholds remain governed by the existing risk policy; no new threshold is invented here.

## Migration and release gates

1. Review the additive W02 D1-01 state migration against the exact production schema.
2. Run W02 username tests, the local SQLite migration audit, TypeScript validation and existing W02 boundary CI.
3. Apply D1-01 only through the existing protected W02 migration workflow after reviewed source is on main.
4. Deploy W02 separately after read-only schema and migration-ledger verification.
5. Do not claim GREEN until executable production evidence is admitted.
