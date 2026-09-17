# Payload Cloudflare D1 Upstream Manifest

Status: RECONCILE_PENDING

## Upstream source

- Repository: `payloadcms/payload`
- Template: `templates/with-cloudflare-d1`
- Upstream ref: `main`
- Upstream commit observed: `9a2cdcb87aacae41b66ab558a056d974c8f38f4e`
- Template `src/` tree: `6a3650d40b78110169641681f02e79f2dff667b2`
- Official template package manifest SHA: `b9d6de5442e65a7674e67f925f1b140f2d6738ef`
- Official template: https://github.com/payloadcms/payload/tree/main/templates/with-cloudflare-d1

## Baseline rule

The official Payload Cloudflare D1 template is the W01 runtime baseline. W01 MUST NOT be treated as a standard Payload scaffold with Cloudflare fixes added afterward.

The template's own dependency versions, runtime structure, Cloudflare bindings, OpenNext integration, D1 adapter, R2 integration, scripts, and engine requirements are the reference baseline. LuckRead-specific contracts and configuration are layered on top only where the applicable Mapping/Contract gates permit the move.

## Locked template dependency baseline

As observed from the official `templates/with-cloudflare-d1/package.json` on `main`:

- Payload: `3.82.1`
- `@payloadcms/db-d1-sqlite`: `3.82.1`
- `@payloadcms/next`: `3.82.1`
- `@payloadcms/richtext-lexical`: `3.82.1`
- `@payloadcms/storage-r2`: `3.82.1`
- `@payloadcms/ui`: `3.82.1`
- `@opennextjs/cloudflare`: `^1.11.0`
- Next: `16.3.3`
- React / React DOM: `19.2.6`
- Node engine: `>=24.15.0`

W01 has been reconciled to these official template dependency versions. Payload `3.87.1` is NOT the W01 version baseline and must not be described as the Cloudflare template version.

## Current repository state

- W01 directory: `workers/W01-payload/`
- W01 package is pinned to the official Cloudflare D1 template dependency versions above.
- W01 Wrangler binding targets D1 database `luckread`.
- Existing LuckRead contracts and migrations remain protected; template reconciliation does not overwrite them.

## Evidence rule

Version alignment alone does not establish runtime compatibility. After this reconciliation, W01 still requires actual dependency installation, build, OpenNext output, D1 schema/migration, and runtime evidence before Mapping 0 can be promoted.

## Gate

This manifest does not declare Mapping 0 GREEN. It records the official Cloudflare D1 template as the W01 baseline and makes the version source explicit and reversible.
