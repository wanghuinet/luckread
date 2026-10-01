# Change Control — SOCIAL-002 Followers / Following Read + Membership Foundation — 2026-10-01

- Change Control ID: `CC-1.0-SOCIAL-002-MEMBERSHIP-FOUNDATION-2026-10-01`
- Status: `CONTRACT-FIRST / ADMITTED / VERIFICATION-PENDING`
- Repository authority: GitHub `main`
- Base SHA: `35e1da3dbcad061db3f9db5840fc85e52d0f9607`
- Backup branch: `backup/creator-social-subscription-before-20261001`
- Work branch: `work/social-follow-subscription-20261001`

## Scope

This slice closes only contract/data-model gaps for:

1. `SOCIAL-002` followers/following read semantics;
2. the minimum Membership foundation for MembershipPlan, Subscription and Entitlement.

## Explicit architecture constraints

- No new Worker.
- No new D1 database.
- No new Task.
- No Payload Collection.
- No Content/W03 change.
- No Creator Center authority is introduced.
- Follower/following counters remain derived, never authoritative.
- Social remains authoritative for Follow relationship state.
- Membership remains authoritative for Subscription/Entitlement lifecycle state.
- Commerce/Payment and Wallet/Ledger remain financial authorities.

## SOCIAL-002

Existing OpenAPI operation IDs are reused:

- `getUsersUserIdFollowers`
- `getUsersUserIdFollowing`

Both are bound by `contracts/api/SOCIAL-002-followers-following-read.v1.json`.

The response is cursor-paginated and bounded. Each item exposes only the referenced user ID and relationship timestamp; profile details remain owned by the User/profile authority. `totalCount` is explicitly derived and rebuildable; there is no counter authority.

The current Follow runtime remains blocked until its trusted admission inputs are reconciled. This change does not bypass that blocker.

## Membership

The minimum domain model is frozen in `contracts/entity/MEMBERSHIP-SUBSCRIPTION-FOUNDATION.v1.json`:

- `ENT-MEMBERSHIP-PLAN`
- `ENT-SUBSCRIPTION`
- `ENT-ENTITLEMENT-GRANT`

The model preserves plan versioning, subscription lifecycle state and entitlement source-plan traceability. No payment fact is duplicated.

## Verification boundary

This change does not claim:

- W05 runtime implementation;
- W07 runtime implementation;
- D1 persistence for Membership;
- security E2E;
- remote runtime evidence;
- Mapping 0 GREEN;
- Creator Center GREEN.

## Next executable slices

`SOCIAL-002` runtime/query evidence comes after the Follow trusted-admission boundary is reconciled.

Membership next requires API/DTO binding and persistence/implementation admission. No runtime code is introduced by this slice.
