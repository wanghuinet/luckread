# CC-1.1-W02-PRINCIPAL-ROLE-ASSIGNMENTS-2026-10-13

## Status

`IMPLEMENTED IN SOURCE / CI AND RUNTIME EVIDENCE PENDING`

## Purpose

Expose the authoritative active, time-valid RoleAssignment facts already read by W02 when it resolves the existing internal principal. This is a prerequisite for the W08 CASL adapter; it does not itself enable CASL or change a business Worker’s authorization decision.

## Boundary

- W02 remains the sole authority for Better Auth session validation, account state, RoleAssignment facts, and L0-L8 resolution.
- W01 consumes the response through the existing `W02_AUTH` Service Binding.
- The existing `POST /internal/auth/principal` path is extended; no route, Worker, D1, Queue, or binding is added.
- Better Auth internals and Payload core are not changed.
- Role assignments are derived from the same D1-01 read used for global layer resolution. Only active assignments whose validity interval contains the evaluation instant are returned.
- Returned fields are limited to assignment ID, canonical role ID, scope type, and scope ID. Credentials, session tokens, and persistence metadata are not returned.
- Global layer selection continues to ignore organization/IP-scoped assignments.
- When the caller requests the authorization context, an unknown role or malformed scope causes fail-closed resolution. No client-provided role or scope is accepted.

## Non-goals

- This change does not pass role assignments to W03/W05/W06/W07.
- This change does not integrate or deploy W08 CASL.
- This change does not claim production authorization is GREEN.
- The permission catalog remains subject to the separate W08 catalog-gap status.

## Verification required

- Unit tests prove active global and scoped assignments are returned from one authoritative query.
- Revoked, future, and expired assignments are excluded.
- Unknown scoped roles fail closed for the trusted authorization context.
- W02 principal tests prove the existing internal response carries the role assignment tuples.
- CI and same-source runtime evidence remain required before treating this adapter input as production-accepted.
