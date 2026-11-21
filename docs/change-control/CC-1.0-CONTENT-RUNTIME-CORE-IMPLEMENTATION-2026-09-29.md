# CC-1.0-CONTENT-RUNTIME-CORE-IMPLEMENTATION-2026-09-29

- Status: **IMPLEMENTATION SLICE / RUNTIME NOT_GREEN**
- Contract authority:
  - `contracts/openapi/v1/openapi.yaml`
  - `contracts/api/content-operation-policy.v1.json`
  - `contracts/state-machines/content.json`
  - `contracts/enums/content-state.json`
  - `contracts/entity/CONTENT-ARTICLE-minimum-field-contract.v1.json`
  - `contracts/persistence/CONTENT-ARTICLE-d1-02-persistence.v1.json`
  - `contracts/transport/W01-W03-content-http-binding.v1.json`

## Implemented slice

W03 source now contains the first Content runtime core:

- authoritative D1-02 Content CRUD/state mutation module;
- canonical lifecycle transition enforcement for creator/moderator layers;
- server-owned `ownerUserId`;
- optimistic concurrency through ETag/version;
- per-domain mutation idempotency;
- one-row fail-closed D1 batch guard so zero-row conditional updates roll back the whole batch;
- database-triggered outbox event creation in the same D1 transaction;
- public list filtering to PUBLISHED only;
- cursor pagination with opaque cursors;
- internal-only W03 HTTP handler under `/internal/content/*`.

## Explicitly not implemented here

- No physical D1-02 UUID/name assignment.
- No W03 Cloudflare deployment.
- No W01 `W03_CONTENT` deployed binding.
- No public W01 proxy route yet.
- No remote runtime evidence.
- No Content/Article GREEN promotion.

The migration is prepared but **execution is not authorized** until the physical D1-02 binding and deployment admission are explicitly evidenced.
