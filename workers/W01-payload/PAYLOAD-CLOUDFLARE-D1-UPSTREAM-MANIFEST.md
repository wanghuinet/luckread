# Payload Cloudflare D1 Upstream Manifest

Status: RECONCILE_PENDING

## Upstream source

- Repository: `payloadcms/payload`
- Template: `templates/with-cloudflare-d1`
- Upstream ref: `main`
- Upstream commit observed: `9a2cdcb87aacae41b66ab558a056d974c8f38f4e`
- Template `src/` tree: `6a3650d40b78110169641681f02e79f2dff667b2`
- Official template: https://github.com/payloadcms/payload/tree/main/templates/with-cloudflare-d1

## Reconciliation rule

The official Cloudflare D1 template is the W01 runtime baseline. LuckRead contracts, Mapping 0 evidence, existing Payload configuration, and existing migrations are not discarded or regenerated merely to match the template.

The template is reconciled as the infrastructure/runtime source; LuckRead-specific configuration is layered on top only after the applicable Mapping/Contract gates permit the move.

## Current repository state

- W01 directory: `workers/W01-payload/`
- Current W01 package uses Payload `3.87.1` and `@payloadcms/db-d1-sqlite` `3.87.1`.
- Current W01 Wrangler binding targets D1 database `luckread`.
- Existing root `src/` remains the current Payload source-of-truth until Mapping 0 is GREEN.

## Important version note

The observed upstream template `package.json` currently declares Payload `3.82.1`, while LuckRead's locked W01 package is already on `3.87.1`. Therefore this reconciliation must not blindly downgrade LuckRead to the template's package versions. The template's Cloudflare runtime structure is adopted; dependency versions remain governed by LuckRead's locked contract/runtime baseline and must be reconciled explicitly.

## Gate

This manifest does not declare Mapping 0 GREEN. It records the official upstream baseline so the subsequent W01 runtime migration can be evidence-driven and reversible.
