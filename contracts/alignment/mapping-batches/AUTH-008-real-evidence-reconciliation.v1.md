# AUTH-008 Real Evidence Reconciliation v1.0

- Feature: `AUTH-008`
- Name: OAuth/social login
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability contract: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Authorization authority: `docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`, `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md`
- Scope/tenant authority: `docs/168-GLOBAL-SCOPE-TENANT-ORGANIZATION-ISOLATION-CONTRACT-v1.0.md`
- Security authority: `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`

## 1. Confirmed contract evidence

1. `AUTH-008` is an explicitly inventoried Blueprint capability: OAuth/social login.
2. The B01 capability contract defines it as federated identity: validate an external provider identity and safely associate or authenticate the local identity.
3. The canonical capability text requires provider assertion verification, anti-account-takeover controls, and a deterministic linking policy.
4. The identity/session registry contains `external-identity-link-01` and `external-identity-unlink-01`, requiring scoped authorization, provider-identity uniqueness, recovery-impact checks, and audit retention.
5. The Open Platform contracts separately define OAuth/OIDC, scope declaration, consent, token lifecycle and revocation as an authorization boundary, and require re-use of the Identity/Auth boundary rather than creating a parallel identity system.
6. The security and authorization contracts require OAuth tokens to honor declared scopes and deny undeclared scope access.

## 2. Repository implementation search result

Searches for OAuth/social-login runtime handlers, provider callbacks, authorization-code processing, PKCE/state/nonce handling, and concrete linked-provider persistence did not identify an executable implementation that can be promoted to canonical AUTH-008 evidence.

## 3. Missing canonical traceability

- Canonical social-login API operation IDs: missing.
- Provider selection/start DTO: missing.
- Authorization callback DTO: missing.
- Provider identity / token exchange DTOs: missing.
- Local identity-link result DTO: missing.
- Provider/client configuration contract: missing.
- External identity entity ID/field contract: missing from the authoritative entity catalog/field contract.
- Provider-subject uniqueness persistence contract: missing.
- State/nonce/PKCE challenge lifecycle contract: missing.
- Redirect URI / callback allowlist contract: missing.
- Provider assertion validation contract: incomplete.
- Account-linking / account-takeover prevention decision matrix: missing.
- Scope/consent mapping for social login versus Open Platform delegated OAuth: incomplete.
- Session issuance/rotation binding after successful federated authentication: incomplete.
- Event IDs for login, link, unlink, provider failure and security outcomes: missing.
- Authoritative D1 persistence/table/column evidence: unresolved.
- Executable implementation evidence: missing.
- Positive/negative security E2E evidence: missing.
- Integration test evidence: missing.
- Evidence Registry IDs: missing.

## 4. Existing related evidence must not be over-promoted

The repository has generic Open Platform OAuth/OIDC and scope contracts, but those are not proof of consumer account social-login implementation. Likewise, the Identity/Session registry's L5/L6 claims for external identity linking do not establish a concrete provider adapter, callback handler, credential exchange, or persistence implementation.

No provider, endpoint, DTO, database field, secret, callback URL, or runtime handler is inferred as canonical merely because the related contracts exist.

## 5. Security gate

AUTH-008 cannot become GREEN until the canonical contract and implementation prove at minimum:

- provider authorization flow is bound to an explicit redirect URI policy;
- state/nonce and PKCE protections are defined where applicable;
- authorization-code/token exchanges use trusted provider endpoints and protected client credentials;
- provider identity assertions are verified before authentication or linking;
- provider subject identity is uniquely scoped and cannot silently attach to another account;
- account takeover and accidental account-merging cases have deterministic behavior;
- linking/unlinking is explicitly authorized and recovery-safe;
- provider access tokens/secrets are never exposed through DTOs, logs or public API;
- resulting local sessions obey the existing account-state and session security model;
- undeclared OAuth scopes are denied;
- failures are resistant to account enumeration and replay where applicable;
- security-sensitive outcomes are audited and observable.

## 6. Closure criteria

AUTH-008 may be promoted only when:

- canonical API and DTO contracts are frozen and mapped;
- external identity entity/fields are authoritative;
- provider and callback security policies are contracted;
- scope/consent semantics are mapped without conflating Open Platform OAuth with social sign-in;
- persistence mapping is verified against migration/schema evidence;
- runtime provider integration exists;
- account-linking and takeover defenses are executable and tested;
- session issuance/rotation is proven end-to-end;
- positive and negative integration/security tests have real execution evidence;
- Evidence Registry references are non-empty and bound to `AUTH-008`;
- final Mapping 0 validation is tied to the resulting commit SHA.

## 7. Gate result

`AUTH-008 = BLOCKED_NOT_GREEN`

No runtime/Worker implementation is authorized by this reconciliation record. The feature remains a mapping blocker until the canonical contracts and evidence chain are established.
