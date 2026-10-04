# Change Control — 1.0 Media Cache / Authorization Reconciliation — 2026-10-04

Status: MERGED / RELEVANT-CI-VALIDATED / RUNTIME-EVIDENCE-PENDING

## Baseline

- authoritative main before slice: `e5d4e62f8c30a08bbcab3f48107139ae241f5a39`
- backup: `backup/2026-10-04-pre-media-private-metadata-hardening`
- working branch: `superpowers/media-private-metadata-hardening`
- merged main: `45ee88ae47dc2a4c42c195ac240f20291fcbd86d`
- pull request: #650

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

## Decision

Choose the conservative authenticated media metadata path.

- Media detail reads are owner-scoped at the Payload collection boundary.
- `GET /api/v1/media/{mediaId}` does not enter shared public cache.
- The v1 response is explicitly projected to delivery metadata and excludes internal ownership fields.
- Public article/video rendering continues to use the content's stored R2 URL references; it does not depend on the media metadata endpoint.
- Public asset policy and public media metadata caching remain deferred until an explicit canonical asset-visibility contract exists.
- The authorization catalog conflict is resolved by adding `media.read.own` (L3 / own scope) for the owner-scoped metadata path; existing `media.read` remains L0 / public for a future explicitly-public asset path.

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

Implementation is admitted under the owner-scoped/no-store decision. Production GREEN remains blocked until CI and independent runtime evidence pass.


## CI Evidence

PR #650 exact head `bc2178dc9b90d0007cda80de2451fe320f5bcfe3`:

- Contract Admission CI run `37182668889` — PASS
- Security Hardening Gate run `37182668920` — PASS
- Payload Implementation Admission run `37182668957` — PASS
- API Contract CI run `37182668909` — PASS
- Worker Directory Drift Gate run `37182668904` — PASS
- W02 RoleAssignment Verification run `37182668916` — PASS
- Worker D1 Access Boundary Gate run `37182668890` — PASS
- Mapping 0 Structural Gate run `37182668902` — PASS
- Worker Terminal Routing Gate run `37182668896` — PASS
- 1.0 D1 Traffic Guard Contract CI run `37182668880` — PASS
- W01 Creator Center Admin Verification run `37182668894` — PASS

Two project-level checks failed without a scoped Media defect:

- Payload Foundation CI run `37182668907` — pre-existing W01 lint baseline; typecheck and security unit tests passed before lint.
- API Inventory Reconciliation run `37182668932` — `failureCount=0`; existing incomplete inventory findings remain for unrelated operations such as `getHomeFeed` and `transitionAccountState`.

W01 Homepage E2E run `37182668875` failed during the local Miniflare/workerd web-server startup with `SQLITE_BUSY` / `database is locked`; production build completed successfully. This is runtime-test environment evidence, not proof of a Media functional defect.

No production GREEN claim is made. Independent deployed runtime evidence remains pending.
