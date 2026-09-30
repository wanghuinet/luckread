# CC-1.1 Moderation W01→W06 Trusted Transport Binding — 2026-10-01

**Status: CONTRACT / RUNTIME IMPLEMENTATION BLOCKED**

Repository: `wanghuinet/luckread`  
Base head: `c4b4cb46c6c352eb362ec5e600d12322e5f3ac9b`

## 1. Purpose

Freeze the internal transport boundary required by GOV-003/GOV-004 without implementing moderation runtime behavior.

The approved logical path is:

`public admin request → W01 authenticated principal → existing W02 session/layer authority → W01 W06_MODERATION Service Binding → W06 moderation authority`

This change does not create a new Worker or D1 and does not authorize runtime implementation.

## 2. Authority

- Authentication remains at W01/Payload.
- Session validity and L0-L8 layer resolution remain dependent on the existing W01→W02 `W02_AUTH` path.
- W06 remains the sole moderation/case/decision authority in T19 / D1-03.
- Content lifecycle remains authoritative in W03.
- W06 must never trust reviewer identity, layer, permission, evidence or risk thresholds from the public request body.

## 3. Transport binding

Machine-readable contract:

`contracts/transport/W01-W06-moderation-http-binding.v1.json`

Binding: `W06_MODERATION → luckread-w06`

Covered operations:

- `listModerationQueue`
- `getModerationCase`
- `decideModerationCase`

The binding forwards only the verified principal identity/layer and required concurrency/idempotency headers. It does not forward the end-user bearer credential.

## 4. Security / fail-closed rules

- Missing principal or layer: deny.
- Layer below L6: deny.
- Operation permission is resolved from canonical contracts; client permission input is non-authoritative.
- Reviewer scope is checked by W06 against authoritative moderation state.
- Missing `If-Match`: 428.
- Version/ETag mismatch: 412.
- Decision retries use the same `Idempotency-Key`.
- No raw evidence or internal risk thresholds cross the normal DTO boundary.
- No direct W02→W06 business Service Binding is introduced.

## 5. Explicit non-actions

- No W06 moderation endpoint implementation.
- No W01 public moderation endpoint implementation.
- No D1-03 migration.
- No Cloudflare binding deployment.
- No new Worker/D1.
- No production GREEN or Evidence Registry promotion.

## 6. Next admission gate

Before runtime implementation, CI and Change Control must reconcile:

`OpenAPI + DTO + Entity + Persistence + W01→W06 transport + Audit + Permission + State + Evidence`

Only the subsequent implementation slice may add the actual existing-Worker Service Binding configuration and runtime handlers, and it must carry deployment/runtime/security evidence.
