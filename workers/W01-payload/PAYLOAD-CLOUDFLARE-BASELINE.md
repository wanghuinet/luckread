# W01 Payload — Cloudflare Development Baseline

Status: DEVELOPMENT-PREP / MAPPING-GATE-PENDING

## Source template

W01 follows Payload's Cloudflare-specific `with-cloudflare-d1` template boundary. The standard Payload deployment shape is not the source template for W01.

## Locked runtime boundary

- Payload Core / Admin runtime
- Next.js + OpenNext Cloudflare runtime
- D1 via `@payloadcms/db-d1-sqlite`
- R2 via Payload's R2 storage integration
- Cloudflare Worker bindings and generated environment types
- Payload migrations
- Payload type generation and import-map generation
- W01-only build/deploy/test configuration

## Version baseline

Payload packages are pinned to 3.87.1 for this repository baseline. The official Cloudflare template on the 3.x branch is the reference shape; the repository baseline uses the 3.87.1 Payload release line because that release includes the Cloudflare D1 template fix.

## Binding boundary

Required W01 bindings:

- `D1` — Payload primary D1 binding
- `R2` — media/object storage binding
- `PAYLOAD_SECRET` — deployment/runtime secret
- `ASSETS` — OpenNext static asset binding

Database and bucket identifiers remain deployment/environment values and are not invented in source control.

## Migration gate

Until Mapping is GREEN:

1. Do not duplicate the existing Payload runtime into W01.
2. Do not independently rewrite `src/payload.config.ts`.
3. Do not regenerate or replace existing migrations merely to fit the new directory.
4. Do not move contract evidence paths without a reconciliation change.

After Mapping is GREEN, migrate the verified runtime as one controlled batch and reconcile scripts, TypeScript paths, tests, CI, migrations, and evidence references together.

## Verification checklist

- [ ] Cloudflare template shape retained
- [ ] Payload 3.87.1 dependency alignment verified
- [ ] D1 adapter remains `push: false`
- [ ] Existing migration directory remains authoritative until migration gate
- [ ] R2 integration is present without moving media business ownership from W06
- [ ] W01 owns Payload runtime; W02 owns content publishing; W06 owns media/video domain behavior
- [ ] Mapping/Contract gate remains GREEN before business implementation
