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

The official Payload Cloudflare D1 template is the W01 runtime source boundary. W01 MUST NOT be treated as a standard Payload scaffold with Cloudflare fixes added afterward.

The template's runtime structure, Cloudflare bindings, OpenNext integration, D1 adapter, R2 integration, scripts, and engine requirements are the reference evidence for the Cloudflare shape. LuckRead-specific contracts and configuration are layered on top only where the applicable Mapping/Contract gates permit the move.

## Historical upstream observation

The following dependency versions belong specifically to the upstream observation recorded by this manifest:

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

These versions MUST NOT be represented as the current W01 package baseline without a fresh reconciliation.

## Current repository state

- W01 directory: `workers/W01-payload/`
- Current W01 package manifest is the authoritative source for the repository's locked dependency versions.
- Current W01 package lock is Payload `3.87.1`, `@opennextjs/cloudflare` `1.20.1`, Next `16.2.6`, React / React DOM `19.2.6`, Node `>=24.15.0`.
- W01 Wrangler binding targets D1 database `luckread`.
- Existing LuckRead contracts and migrations remain protected; template reconciliation does not overwrite them.

## Evidence rule

Upstream template observation and dependency alignment do not establish runtime compatibility. W01 still requires actual dependency installation, type/lint validation, build, OpenNext output, D1 schema/migration, and runtime evidence before Mapping 0 can be promoted.

## Gate

This manifest does not declare Mapping 0 GREEN. It records the historical upstream Cloudflare D1 template observation and explicitly separates that observation from the current W01 dependency lock.
