# Change Control — 1.0 Media Cache / Authorization Reconciliation — 2026-10-04

Status: BLOCKED / DECISION-MATERIAL / IMPLEMENTATION-PENDING

## Baseline

- authoritative main: `8482ba75bf5194b3955e7560074f78d20d558978`
- backup: `backup/2026-10-04-pre-media-cache-authz-reconciliation`
- working branch: `superpowers/media-cache-authz-reconciliation`

## Finding

Current W01 Media detail behavior and the canonical Media API operation policy are not aligned.

### Contract requirements

`contracts/api/media-operation-policy.v1.json` defines `getMedia` as:

- visibility: `public_or_private_by_asset_policy`;
- authorization: required, `media.read`, resource scope;
- cache: `POLICY_DEPENDENT`, shared cache disabled by default;
- shared caching allowed only when the asset is explicitly public;
- security invariant: `private_metadata_not_publicly_cached`.

### Current implementation

`workers/W01-payload/src/app/api/v1/media/[mediaId]/route.ts` currently:

- sends every detail GET through `cachedPublicGet(..., 'media-detail', ..., 30)`;
- does not establish an explicit asset-publicness decision before entering shared cache;
- projects the full Payload Media document with `...document`, so internal metadata such as `ownerUserId` is not explicitly excluded.

`workers/W01-payload/src/collections/Media.ts` currently has no explicit asset visibility field/policy and uses `access.read: () => true`.

## Risk

This is a security/contract boundary issue, not merely a cache hit-rate issue.

Without an explicit asset-publicness source, a shared cache cannot prove that a Media resource is eligible for anonymous/public reuse. The current projection also does not enforce a minimal public metadata schema.

This must not be classified as GREEN.

## Decision material

No implementation is admitted in this change-control record.

The minimum safe direction is to choose one canonical policy before code changes:

1. **Explicit asset visibility path** — add/define a canonical public/private asset policy, then allow shared cache only for explicitly public assets and use an allowlisted public response projection.
2. **Authenticated media metadata path** — keep Media detail resource-scoped and remove anonymous/shared cache semantics until public asset policy exists.

Any choice must also define:

- how existing assets are classified;
- how publish/unpublish affects asset publicness, if applicable;
- whether playback may remain public independently of metadata authorization;
- cache invalidation when asset visibility changes;
- test/evidence requirements for private-asset non-leakage.

## Non-Goals

- no new Worker;
- no new D1;
- no R2/storage topology change;
- no Payload core modification;
- no W05 follow-list optimization;
- no production GREEN claim.

## Evidence

- `contracts/api/media-operation-policy.v1.json` — canonical Media operation policy.
- `docs/302-AUTHORIZATION-CACHE-SECURITY-CONTRACT-v1.0.md` — P0 authorization/cache security contract.
- `docs/167-CACHE-INVALIDATION-HOT-KEY-STAMPEDE-CONTRACT-v1.0.md` — cross-cutting cache/invalidation contract.
- `workers/W01-payload/src/app/api/v1/media/[mediaId]/route.ts` — current implementation.
- `workers/W01-payload/src/collections/Media.ts` — current Media access model.

## Gate

Implementation remains BLOCKED until the asset-publicness / authorization policy is explicitly resolved and the resulting contract/runtime/test changes pass the normal admission gates.
