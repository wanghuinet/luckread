# CC-W02-W08-AUTHORIZATION-BOUNDARY-2026-10-12

Status: **APPROVED FOR SOURCE IMPLEMENTATION / NOT DEPLOYED**

## Decision

The project owner has directed the following responsibility boundary:

- **W02 = Identity / Account**: Better Auth, account creation and lifecycle, authentication, sessions, email verification, and authoritative account state.
- **W08 = Authorization / Creator / Organization**: shared L0–L8 permission decisions using CASL, plus creator/organization responsibilities.
- **T01/T02 remain W02; T03/T04 are assigned to W08.**
- D1-01 remains the existing Identity / Account / Access database. No new Worker, D1, Queue, or data domain is added.
- Better Auth and Payload Core remain unchanged.

## Implementation boundary for this slice

1. Place the CASL policy engine and its L0–L8 tests under `workers/W08-creator`.
2. Add the internal `POST /internal/authz/check-permission` endpoint to the already-provisioned `luckread-w08-creator` Worker source.
3. Resolve actor identity from the W02 session through the existing private Service Binding; derive account state and layer/scoped-role context from persisted D1-01 facts. Browser-cookie and native Bearer session credentials are forwarded unchanged through the existing W01→W08→W02 bindings; W02 Better Auth remains the only credential-validation authority. W08 never trusts body-supplied subjectId, layer, account state, or scope grants. The request body cannot supply subjectId, layer, account state, or scope grants. Resource attributes must be loaded server-side from the owning domain.
4. Keep the endpoint internal-only, with `workers_dev=false`, no public route, no new caller Service Binding, and `Cache-Control: no-store`.
5. Do not deploy, mutate remote D1, or move non-W08 callers to the generic permission endpoint in this source slice. The existing W08 creator-qualification routes are intentionally changed from duplicate layer-only guards to the local shared CASL policy; W02 session/principal resolution and W02-owned RoleAssignment grant transport remain authoritative and unchanged.
6. Existing W02 role-materialization and session-layer-projection code remains a documented compatibility dependency while the T03 runtime closeout is staged. It must not be used as a substitute for W08's CASL business-permission decision.
7. A positive CASL result remains only one authorization facet. Authentication/session validity, MFA, governance, ownership/resource facts, entitlement, approvals, and business-state checks remain mandatory where applicable.

## Canonical document effect

This record amends the active responsibility/task mapping in the Worker Master, Worker × D1 Binding Mapping, and Final Mapping. Historical evidence artifacts are not rewritten. The 12-Worker / 4-D1 / 25-Task topology remains unchanged.
