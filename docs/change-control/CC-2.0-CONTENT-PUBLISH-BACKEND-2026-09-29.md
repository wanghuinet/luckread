# 2.0 Content Publish Backend — Implementation Slice

- Status: IMPLEMENTATION SLICE / RUNTIME NOT_GREEN
- Branch: feat/content-publish-2-0-2026-09-29
- Backup: backup/pre-content-2-0-publish-2026-09-29

## Goal

Make the existing content backend usable for the first 2.0 creator publishing path without adding Workers, D1 domains, or Tasks.

## Included

- article content;
- dynamic/post content;
- video content metadata with validated media references;
- image/video references and optional cover reference;
- existing D1-02 authoritative lifecycle and ownership rules;
- existing W01 public /api/v1/contents boundary;
- draft → review → approval → publish lifecycle remains the only publication path;
- idempotency and optimistic concurrency remain mandatory.

## Media rule

Binary media remains object-storage data. Content stores only validated references. The 2.0 slice does not create a second media system and does not put large binary payloads into D1.

## Explicitly not claimed

- no GREEN/runtime claim;
- no remote D1 migration execution;
- no transcoding/processing admission claim;
- no recommendation/feed ranking;
- no new Worker, D1, Task, or Payload Core modification.

## Acceptance path

creator authentication → create draft → attach media references → edit → submit/review/approve → publish → public read

Runtime GREEN requires the existing CI gates plus remote D1 migration/deployment and executable E2E evidence.
