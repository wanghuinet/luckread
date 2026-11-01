# Change Control — W02 Username Change Authority

- ID: CC-W02-USERNAME-CHANGE-AUTHORITY-2026-11-02
- Scope: W02 / Better Auth / D1-01 username authority only
- Base: `1605e8d73db5d0fe47520ef3e6cbd823be4c0856`
- Status: OWNER_POLICY_DECISIONS_CAPTURED / IMPLEMENTATION_CANDIDATE
- No production migration, Worker deployment, PR merge, or W01 public API activation is authorized by this record.

## Owner decisions

1. The user explicitly selected a **30-day cooldown** between successful username changes.
2. The user delegated the initial LuckRead reserved-username list to the implementation owner.
3. The first-release policy is stored in `contracts/security/username-reservation-policy.v1.json`.

## Reserved-name policy

The policy protects exact normalized names for LuckRead brand and official-account identifiers; platform administration, support, security, legal, trust and moderation identities; active W01 page routes and API/auth/system route names; and infrastructure/service hostnames and operational endpoints.

Matching is exact after trim → Unicode NFC → casefold. Accepted usernames remain ASCII alphanumeric, 6–32 characters, consistent with the active W01 registration validator. Therefore ASCII lowercase is equivalent to casefold for accepted values. No broad prefix or suffix reservation is applied. Unicode confusables are rejected by the character allowlist.

## W02 authority and persistence

- Better Auth session is the only source of the actor and target is always that session's own user ID.
- Better Auth `user.username` remains the current username authority.
- Existing `auth_identities.username_normalized` is synchronized by a D1 trigger in the same transaction.
- `auth_username_change_history` stores old handles permanently, with a unique normalized old handle, version, session, correlation ID, successful timestamp and hashed idempotency material.
- A previous username is never available for reuse.
- `display_name` and Better Auth `user.name` are not changed.
- Mutations require Idempotency-Key and the W02 username ETag in If-Match.
- Existing W02 rate-limit namespaces are reused for account, identity, device, endpoint and global limits. No new limiter namespace is created.
- The D1 batch is the only synchronous mutation. No new Worker, D1, Queue or Service Binding is introduced.

## Boundaries and deferred integrations

- This slice adds private W01-service-bound W02 state/change endpoints. It does not expose a new public W02 route.
- W01 public `PATCH /users/me/username`, removal of username from generic profile PATCH, W01 cache invalidation and W02-to-W01 projection/event consumption remain separate follow-up modules.
- PR #1481 remains independent and must not be merged or deployed until its own W01 migration admission is complete.
- AUTH-003 credential-management APIs and its HMAC hash key remain unimplemented. This change does not write credential hashes or change auth_credentials rows; an existing active username credential collision is rejected.
- Username-change risk-specific step-up policy is not newly invented here. A live Better Auth session is required; when MFA is enabled, Better Auth issues the authenticated session only after its challenge. Any stronger step-up threshold requires a separate risk-policy decision.

## Migration and release gates

1. Review additive migration `0010_auth_username_change_history.sql` against exact production schema.
2. Run W02 migration static audit, username tests, W02 TypeScript validation and existing boundary CI.
3. Apply D1-01 migration only through the existing protected W02 migration workflow after main contains the reviewed source.
4. Deploy W02 separately after read-only schema/ledger read-back confirms migration 0010.
5. Do not claim GREEN until executable production evidence is admitted.
