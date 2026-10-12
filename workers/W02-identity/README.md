# W02 — Identity / Account

Canonical Worker role: **Identity / Account**.

Project authority has selected this repository path as the physical source location for canonical W02:
`workers/W02-identity`

The directory name `W02-identity` is the canonical physical path for W02; Worker authority remains defined by the Worker Master. Canonical W02 owns T01/T02 and D1-01 identity/account state under the amended Worker Master.

Deployment and inter-Worker transport are governed by:
`docs/change-control/CC-MAPPING-0-E6-W02-DEPLOYMENT-TRANSPORT-DECISION-2026-09-22.md`

W02 remains the sole account-system core:
- Better Auth owns authentication, sessions and email-verification flow.
- W02 owns account creation/lifecycle and authoritative account state.
- Payload Core and Better Auth implementation are not replaced or modified by the W08 CASL change.
- W02 continues to host the existing RoleAssignment materialization and layer-projection code during this incremental closeout because account lifecycle and authentication response paths currently depend on it. That compatibility code does not make W02 the shared business-permission policy engine; CASL policy evaluation belongs to W08.
- Existing internal session endpoints remain Service-Binding transports only. No public W02 auth endpoint is introduced by the W08 authorization change.
- D1-01 schema/migration files remain in the established W02 migration runner in this slice; this is physical schema deployment location, not a second permission-decision authority.

W08 authorization contract:
`workers/W08-creator/src/authz/casl-policy.ts` and `POST /internal/authz/check-permission`.

No Worker deployment is implied by source changes. Remote D1 mutation and controlled Worker deployment still require their own evidence and authorization.
