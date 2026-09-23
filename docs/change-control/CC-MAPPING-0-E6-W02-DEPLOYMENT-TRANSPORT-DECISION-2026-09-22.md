# Mapping 0 — E6 W02 Deployment & Transport Decision — 2026-09-22

- Status: `DECISION_RECORDED — IMPLEMENTATION_ADMITTED / DEPLOYMENT_EVIDENCE_PENDING`
- Scope: `GAP-E6-RUNTIME-001`
- Repository authority: GitHub `main`
- Canonical logical Worker: W02 — Identity / Account / Authorization
- Source path selected by project authority: `workers/W02-content`

## Decision

### 1. Physical Worker identity

The project authority has selected:
- Repository source path: `workers/W02-content`
- Cloudflare Worker name: `luckread-w02`

The physical name intentionally does not inherit the legacy `content` directory label. The directory is the selected source location; the Worker name follows the canonical logical identity W02.

### 2. Deployment

Deployment is selected as a controlled GitHub Actions deployment using Wrangler.

Required configuration:
- Wrangler config: `workers/W02-content/wrangler.jsonc`
- Worker name: `luckread-w02`
- Worker entrypoint: `src/index.ts`
- Compatibility date: `2025-08-15`, matching the existing W01 Payload baseline unless a separately approved runtime compatibility change is introduced.
- Authentication: GitHub Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- Deployment command: `wrangler deploy`.
- Deployment trigger: controlled `workflow_dispatch` for the initial/admission-bound deployment; no implicit push-to-production deployment is introduced by this decision.
- Source provenance: workflow must pin the exact implementation commit and retain build/deployment evidence.

This deployment choice is consistent with the repository's existing fail-closed admission model. The separate E6 implementation-admission Change Control has now admitted source implementation; this decision still does not by itself prove Cloudflare deployment.

### 3. W01 → W02 transport

Transport is selected as a Cloudflare Worker Service Binding using the HTTP interface.

W01 binding to be added to `workers/W01-payload/wrangler.jsonc`:
- binding: `W02_AUTH`
- service: `luckread-w02`

Runtime call form: `env.W02_AUTH.fetch(request)`.

Scope:
- Direction: W01 → W02 only for governed AUTH/T01/T03 calls.
- W02 remains the business/authorization authority.
- W01 remains the public API/Gateway edge.
- W01 does not receive direct D1-01 authority through this transport.
- The Service Binding is internal; no public W02 authentication endpoint is required solely for W01-to-W02 traffic.

HTTP Service Binding is selected rather than RPC because the existing W01 boundary is an HTTP/API edge and the AUTH-002 flow already has request/response/error wire contracts. The binding transports the governed request/response without making W01 depend on a W02-specific class or method surface.

### 4. Required binding contract evidence

Before runtime execution is accepted, the implementation must record:
- caller = W01;
- callee = W02;
- operation IDs and versions = existing governed AUTH/T01/T03 contracts only;
- authentication/authorization requirements = existing contracts only;
- request/response/error schemas = existing admitted Wire Authority only;
- timeout/retry/failure/backpressure behavior;
- idempotency/correlation identifiers where mutation is involved;
- audit/observability references;
- source commit → build → deployment evidence.

### 5. Explicit non-decisions

This decision does not:
- by itself prove W02 runtime deployment or runtime acceptance;
- by itself prove RoleAssignment persistence runtime acceptance;
- create a Worker or D1 resource immediately;
- modify Payload Core;
- add a public W02 API;
- introduce a new D1;
- create a second session authority;
- infer any missing Contract or schema.

The existing E6 implementation-admission Change Control remains the implementation gate.

## Result

- Decision A physical source path: **DECIDED**
- Deployment: **DECIDED**
- Transport: **DECIDED**
- Physical Worker deployed existence: **NOT_YET_VERIFIED**
- W01 service binding deployed existence: **NOT_YET_VERIFIED**
- ENT-ROLE-ASSIGNMENT implementation/persistence: **NOT_YET_VERIFIED**
- E6 runtime implementation: **ADMITTED_FOR_SOURCE_ONLY / RUNTIME_EVIDENCE_PENDING**
- Mapping 0: **NOT_GREEN**