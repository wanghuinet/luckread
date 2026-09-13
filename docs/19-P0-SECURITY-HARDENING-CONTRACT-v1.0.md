# P0 Security Hardening Contract v1.0

Status: CONTRACTED / IMPLEMENTATION REQUIRED

## 1. Purpose

This contract hardens the existing authorization model into an executable security boundary. It does not replace the Authorization Decision Contract; it adds mandatory controls for revocation, cache invalidation, field ownership, tenant isolation, replay resistance, and security evidence.

## 2. Canonical authorization invariant

A request may be ALLOW only when every mandatory check is authoritative and current:

`authentication AND account_state AND subject_type AND permission AND scope AND resource AND policy AND required_approval AND business_state AND credential`

Any missing, stale, indeterminate, or failed mandatory input produces DENY.

## 3. Revocation precedence

Authoritative revocation always overrides cached ALLOW decisions.

The following changes MUST invalidate or version-bump authorization state:

- account suspension, lock, disable, deletion
- credential/session/token revocation
- role or permission removal
- organization membership removal
- scope removal
- entitlement expiration/revocation
- delegation expiration/revocation
- ownership transfer

Required version dimensions:

- `authorizationVersion`
- `credentialVersion`
- `membershipVersion`
- `entitlementVersion`
- `delegationVersion`

An authorization cache entry is valid only when its versions match the authoritative state.

## 4. Field ownership

Client input MUST be treated as an allowlisted command projection, never as an unrestricted persistence object.

Server-owned/protected fields include at minimum:

`role`, `status`, `verified`, `owner_id`, `organization_id`, `scope_id`, `entitlements`, `subscription_state`, `payment_state`, `moderation_state`, `security_state`.

Protected fields supplied by a client MUST be rejected or stripped before persistence according to the field policy. Silent privilege escalation is forbidden.

## 5. Resource and tenant isolation

A resource identifier never proves authorization. Every object access MUST evaluate resource ownership or an explicit grant together with organization/tenant scope.

Cross-organization access MUST fail closed, including when the caller knows a valid resource identifier.

Client-supplied `owner_id`, `organization_id`, or `scope_id` MUST NOT establish authority.

## 6. Credential and replay security

Credential revocation MUST be authoritative. Expired, revoked, malformed, or context-invalid credentials MUST produce DENY.

State-changing requests MUST support idempotency where the operation is retryable or externally triggered. Replay-sensitive operations MUST bind authorization to the authenticated subject, action, resource, and relevant credential/session context.

## 7. Delegation and service principals

Delegation is explicit, scoped, time-bounded, revocable, and auditable. Delegated authority MUST NOT exceed the delegator's effective authority.

Service/API clients MUST use declared scopes and resource scope. Internal origin or API-key possession alone MUST NOT establish administrator authority.

## 8. Break-glass

Break-glass is a separate audited capability. It requires explicit authorization, reason, actor, target, expiry, and audit evidence. It MUST NOT bypass account security controls by default.

## 9. Payload boundary

Payload authentication, Payload admin capability, Local API access, collection access, or known document IDs MUST NOT establish public API authorization. The final operation is allowed only when both the public authorization decision and Payload enforcement allow it.

## 10. Required negative tests

The security gate MUST cover at minimum:

- anonymous protected access
- IDOR
- cross-tenant access
- role escalation
- protected-field injection
- status escalation
- stale authorization cache after revoke
- revoked credential
- suspended account
- expired entitlement
- expired/revoked delegation
- undeclared API/service scope
- Payload-admin/public-API mismatch
- Local API bypass
- ownership transfer race
- permission revoke race

## 11. Evidence requirements

Every security test result MUST retain:

`commit_sha`, `contract_sha`, `test_run_id`, `case_id`, `expected`, `actual`, `request_id`, `trace_id`, `policy_version`, `authorization_version`, and `result`.

Missing evidence is FAIL, not UNKNOWN.

## 12. Green gate

`SECURITY_GREEN` requires:

- contract artifacts valid
- static bypass scan green
- revocation policy green
- field policy green
- tenant/resource isolation tests green
- negative authorization E2E green
- concurrency/revocation tests green
- evidence registry complete

Until all required evidence exists, Security Green remains BLOCKED.
