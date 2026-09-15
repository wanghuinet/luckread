# AUTH-006 Real Evidence Reconciliation v1.0

- Feature: `AUTH-006`
- Name: passkey/WebAuthn extension
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability contract: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Entity authority: `contracts/entity/entity-catalog.v1.json`
- Field authority: `contracts/entity/entity-field-contract.v1.json`

## 1. Confirmed contract evidence

1. `AUTH-006` is an explicitly inventoried Blueprint capability: passkey/WebAuthn extension.
2. The B01 reconciliation contract defines the capability as registering and authenticating a bound passkey under the existing identity security model.
3. The canonical capability contract explicitly requires credential binding, origin validation, replay protection and account-state checks.
4. The current feature record states that detailed canonical contracts are not yet established.
5. Repository searches did not identify an executable passkey/WebAuthn registration or assertion-verification implementation.

## 2. Missing canonical traceability

- Canonical API operation IDs: missing.
- Registration-options DTO: missing.
- Authentication-options DTO: missing.
- Registration-result DTO: missing.
- Authentication-result DTO: missing.
- Passkey credential/entity ID: missing.
- Credential field contract: missing.
- WebAuthn challenge lifecycle contract: missing.
- Origin/RP-ID policy reference: missing.
- Counter/replay-state persistence mapping: missing.
- Account-state/security policy binding: incomplete.
- Permission/scope mapping: missing.
- Event IDs for registration/authentication/revocation: missing.
- Authoritative D1 persistence/table/column evidence: unresolved.
- Executable implementation evidence: missing.
- Security E2E evidence: missing.
- Integration test evidence: missing.
- Evidence Registry IDs: missing.

## 3. Evidence interpretation rules

The existence of the Blueprint capability, identity/session registry, or generic Payload authentication support does not establish WebAuthn implementation. No inferred endpoint, DTO, credential field, challenge store, RP configuration, or verification routine is promoted to canonical evidence.

## 4. Security gate

AUTH-006 cannot become GREEN until the canonical contract explicitly binds passkey credentials to an identity, defines challenge issuance and single-use consumption, validates origin/RP context, rejects replay, evaluates account state, protects credential material, and records required security events. Negative tests must prove invalid/replayed assertions fail closed.

## 5. Closure criteria

AUTH-006 may be promoted only when:

- API and DTO contracts are frozen and mapped;
- credential entity and fields are authoritative;
- challenge and credential lifecycle are explicitly contracted;
- persistence mapping is verified against migration/schema evidence;
- registration and authentication implementation exists;
- origin/RP/replay/account-state security controls are executable and tested;
- positive and negative integration/security tests have real execution evidence;
- Evidence Registry references are non-empty and bound to `AUTH-006`;
- final Mapping 0 validation is tied to the resulting commit SHA.

## 6. Gate result

`AUTH-006 = BLOCKED_NOT_GREEN`

No runtime/Worker implementation is authorized by this reconciliation record. The feature remains a mapping blocker until the canonical contracts and evidence chain are established.
