# CC-MAPPING-0-AUTH-013-PUBLIC-TRANSPORT-IMPLEMENTATION-ADMISSION-2026-09-28

## Status

`IMPLEMENTATION_AUTHORIZED_FOR_FOCUSED_SLICE / AUTH-013_NOT_GREEN`

## Supersedes

This control supersedes the dependency-only execution status in
`docs/change-control/CC-MAPPING-0-AUTH-013-PUBLIC-TRANSPORT-DEPENDENCY-2026-09-25.md`
only for the current execution question.

The former E6 dependency is no longer the active blocker because E6 Runtime-003
was previously verified and admitted, and its current production-facing
implementation is already represented in the current W01/W02 authentication
chain.

## Authorized slice

Implement only the canonical public transport for the already-admitted
`transitionAccountState` operation:

- public boundary: W01
- method/path: `POST /v1/users/{userId}/account-state`
- operationId: `transitionAccountState`
- trusted principal source: current W01 Payload authentication/session runtime
- W01 -> W02 transport: existing `W02_AUTH` Service Binding
- authoritative business execution: W02 / D1-01
- state mutation: existing `applyAccountStateTransition` kernel
- optimistic concurrency: required `If-Match`
- public request fields: only canonical `to` and `reason`
- actor type, permission, approval and precondition inputs: derived/validated on
  W02 from the authenticated principal and canonical transition/permission
  authorities; never accepted from the client as authoritative.

## Security boundary

The focused implementation MUST:

1. authenticate the caller through the existing W01 native Payload auth path;
2. validate the existing authoritative session/token state through the existing
   W02 session boundary;
3. identify the caller from the verified principal, not request body fields;
4. derive the allowed transition permission and actor class from the canonical
   account state machine and permission/layer authorities;
5. fail closed when the required role/permission or state precondition is absent;
6. preserve the existing W02 atomic state + durable publication journal +
   suspension/ban session-invalidation batch;
7. return only the canonical transition response surface.

## Non-authorizations

- no new Worker, D1, Queue or Service Binding;
- no direct W01 D1-01 writes;
- no client-supplied actor/permission/approval authority;
- no second authorization engine;
- no changes to the canonical OpenAPI operation or DTO schemas;
- no feed/search/deindex implementation;
- no Evidence Registry GREEN promotion;
- no production deployment.

## Evidence gate

After implementation, the same-SHA controlled evidence MUST prove at minimum:

- missing authentication is denied;
- stale/invalid session is denied;
- self-owned user transitions obey the state machine;
- privileged transition permission is derived server-side;
- client-supplied actor/permission/approval fields cannot alter authorization;
- stale If-Match is rejected without mutation;
- successful transition returns the canonical response;
- W02 durable journal is written atomically with the state mutation.

AUTH-013 remains NOT_GREEN until downstream audit/queue/session/E2E and complete
lifecycle-side-effect evidence are reconciled.

## Source verification closure — 2026-09-28

- Exact tested source SHA: `0af2fcb66b6bb54ace065b7debe5559a80a285a4`
- W02 AUTH-013 Runtime Source Verification run: `36431940464`
- Job: `108959464320`
- Artifact: `10973254137`
- Artifact SHA-256: `5c154a9322abc0d3aa7afd078d81d5646b978ce55392cc3f2320e8a39b6bb8d9`
- Typecheck: PASS
- AUTH-013 account-state + publication-journal tests: PASS (23 total, including trusted-principal authorization tests)

This closes the **source implementation verification** gate for the focused slice.
It does not promote AUTH-013 to GREEN and does not establish public W01 HTTP E2E, Cloudflare production deployment, or the complete downstream lifecycle/security evidence chain.
