# Change Control — AUTH-010 Current-Head Readiness Reconciliation
## 2026-09-29

- Control ID: `CC-MAPPING-0-AUTH-010-CURRENT-HEAD-READINESS-RECONCILIATION-2026-09-29`
- Scope: Mapping 0 / AUTH-010 current-head contract-readiness reconciliation only.
- Status: `RECONCILED — OPENAPI AND PERMISSION PRECONDITIONS CLOSED`
- Source head: `60ab660f2b9791dea50438aba3ce5bf8191488ff`
- Backup: `backup/pre-auth010-current-head-reconciliation-20260929`
- Working branch: `reconcile/auth010-current-head-readiness-20260929`

## Authoritative current-head findings

The current `main` content was inspected directly at the source head above.

### 1. Canonical OpenAPI is already present

`contracts/openapi/v1/openapi.yaml` currently contains:

- `GET /auth/sessions` with operationId `authSessionList`;
- `DELETE /auth/sessions/{sessionId}` with operationId `authSessionRevoke`;
- cursor/limit parameters for list;
- maximum 50 returned session items;
- privacy-safe session projection;
- idempotency key for revoke;
- HTTP 204 revoke success.

Therefore the earlier readiness wording that describes these paths as absent is stale relative to current `main`.

### 2. Canonical DTO bindings are already present

`contracts/dto/auth-dto-contract.v1.json` currently binds:

- `authSessionList` → `DTO-AUTH-SESSION-LIST-RESPONSE` → canonical OpenAPI response schema;
- `authSessionRevoke` → `DTO-AUTH-SESSION-REVOKE-PATH` / `DTO-AUTH-SESSION-REVOKE-RESPONSE` → canonical OpenAPI parameter/response boundary;
- both operations to `ENT-SESSION`.

This is contract binding only; it is not runtime evidence.

### 3. Permission authority is already present

`contracts/authz/permissions.json` currently contains both:

- `user.session.read` → own scope;
- `user.session.revoke` → own scope, audit required.

`contracts/api/auth-operation-policy.v1.json` binds these permissions to the two AUTH-010 operations and records the existing resource, cache, idempotency, anti-abuse, and security rules.

Therefore the older AUTH-010 permission-gap wording is stale relative to current `main`.

## Current disposition

The canonical OpenAPI/DTO/permission prerequisite is **closed at the current head**.

The following remain open and are not promoted by this reconciliation:

- authoritative public W01 handler implementation;
- W01 → W02 runtime binding evidence for AUTH-010;
- authoritative W02 session list/revoke runtime implementation for these public operations;
- persistence/migration execution evidence for the AUTH-010 runtime chain;
- private-cache/revocation convergence execution evidence;
- cross-account denial and stale-state security evidence;
- Evidence Registry execution admission;
- Mapping 0 GREEN.

Known Worker ownership is inherited from the existing B01-B03/capability mappings: AUTH-010 is assigned to W02 for its identity/session service responsibility. This reconciliation does not create a new Worker, D1, Queue, Service Binding, cache, or public route.

## Non-goals

- Do not rerun already PASS_VERIFIED AUTH-002/AUTH-003/runtime evidence.
- Do not change Payload native session timestamps or create a second session entity.
- Do not hand-author or execute D1 migration.
- Do not mark AUTH-010 runtime GREEN from contract presence alone.

## Next admissible AUTH-010 slice

Freeze the implementation binding boundary from the already-admitted W01 public authentication boundary and W02 identity/session ownership, then admit the smallest executable list/revoke runtime slice and its focused tests. Runtime evidence remains a separate gate.

