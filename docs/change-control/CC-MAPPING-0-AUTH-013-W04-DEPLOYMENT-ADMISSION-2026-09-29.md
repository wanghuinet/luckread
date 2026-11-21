# CC-MAPPING-0-AUTH-013-W04-DEPLOYMENT-ADMISSION-2026-09-29

## Status

`ADMITTED_FOR_CONTROLLED_PROVISIONING`

## Exact source

- Worker: `luckread-w04`
- Source path: `workers/W04-feed-search`
- Entrypoint: `src/index.ts`
- Source SHA: the exact merged `main` SHA containing the authorization marker
- Wrangler: `4.116.0`

## Deployment controls

The controlled deployment workflow must:

1. checkout the exact pushed `main` commit;
2. verify the authorization marker and W04 physical binding configuration;
3. type-check the W04 bootstrap source;
4. deploy with pinned Wrangler `4.116.0`;
5. record Cloudflare deployment/version output;
6. perform no D1 mutation.

## Trigger boundary

This provisioning workflow is intentionally triggered only when the dedicated authorization marker changes on `main`. Ordinary future W04 implementation changes must not silently deploy from this workflow.

## Acceptance

Accepted physical provisioning evidence must establish:

- Worker resource name = `luckread-w04`;
- deployment succeeded;
- a Cloudflare Worker version was created;
- source provenance equals the merged authorization-marker commit;
- no D1 or unrelated Worker was created or modified.

Feature implementation remains a separate controlled gate.
