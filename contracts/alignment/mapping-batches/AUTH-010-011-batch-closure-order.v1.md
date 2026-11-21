# AUTH-010 / AUTH-011 Batch Closure Order v1.0

Status: ACTIVE

## Objective

Close the session-management and token-refresh mapping without allowing static inventory entries to masquerade as runtime evidence.

## Batch A — AUTH-010

1. Canonical OpenAPI `/auth/sessions` paths.
2. Resolve DTO schema refs.
3. Validate OpenAPI and DTO binding.
4. Freeze handler contract.
5. Bind handler to authentication + permission + self/own predicate.
6. Bind Payload native session fields and `auth_session_state` extensions.
7. Implement bounded list and idempotent revoke.
8. Prove private-cache behavior and revoke invalidation.
9. Execute cross-account and stale-cache security tests.
10. Record Evidence Registry execution records.

## Batch B — AUTH-011

1. Canonical OpenAPI `/auth/refresh` path.
2. Request/response DTO reconciliation.
3. Credential/session field authority.
4. Rotation transaction boundary.
5. Reuse detection.
6. Token/session-version enforcement.
7. Security E2E.
8. Evidence Registry execution records.

## Ordering invariant

AUTH-011 must consume the canonical session model established by AUTH-002/AUTH-010. It must not introduce a competing session entity or duplicate native Payload session timestamps.

## Current status

- AUTH-010: NOT_GREEN; OpenAPI remains the immediate blocker.
- AUTH-011: BLOCKED_NOT_GREEN; refresh runtime chain is not evidence-complete.
- Neither feature is authorized for production implementation based solely on current static contracts.

## Quality rule

Batching increases throughput of contract closure; it does not lower evidence requirements. Every green transition requires executable, traceable evidence.
