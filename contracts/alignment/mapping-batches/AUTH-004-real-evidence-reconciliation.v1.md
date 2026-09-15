# AUTH-004 Real-Evidence Reconciliation v1.0

- Feature: `AUTH-004`
- Name: password reset/change
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability contract: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Entity authority: `contracts/entity/entity-catalog.v1.json`
- Field authority: `contracts/entity/entity-field-contract.v1.json`

## 1. Confirmed contract evidence

1. The Blueprint and feature inventory define `AUTH-004` as password reset/change.
2. The B01 reconciliation contract defines the capability as validating an authorized password lifecycle request and rotating credential state.
3. The B01 contract requires recovery tokens to be single-use and time-bounded, and requires credential material to remain non-exposed.
4. The repository's identity/session registry is an authority/reference document for credential lifecycle validation, but its validation units are not executable implementation evidence.
5. The currently verified `ENT-USER` entity does not establish a canonical password credential entity or password-recovery persistence contract.
6. `ENT-IDENTITY` and `ENT-CREDENTIAL` remain proposed in the current entity catalog and therefore cannot be promoted to implementation evidence by inference.

## 2. Missing canonical traceability

- Canonical API operation ID(s) for password change/reset lifecycle: missing or not fully bound.
- Request/response DTO IDs: missing.
- Credential entity/field IDs: missing.
- Recovery-token entity/field persistence mapping: missing.
- Permission/scoped authorization mapping for authenticated password change: missing.
- Account recovery authorization boundary: missing.
- Account/session invalidation semantics after password change/reset: incomplete.
- Event IDs for password change/reset and credential rotation: missing.
- Worker/runtime implementation evidence: missing.
- D1 domain/table/column/migration evidence: unresolved.
- Executed security tests for replay, expiry, enumeration resistance, and credential non-disclosure: missing.
- Integration/E2E execution evidence: missing.
- Evidence Registry IDs bound to `AUTH-004`: missing.

## 3. Evidence interpretation rules

The existence of Payload authentication support, a registry validation-unit name, or a generic user collection does not prove password reset/change implementation. No password, recovery-token, handler, persistence table, permission, lifecycle transition, or test result is promoted from inference.

## 4. Security gate

`AUTH-004` cannot become GREEN until password-reset and password-change flows have authoritative authorization boundaries, single-use and time-bounded recovery semantics, replay resistance, protected-account existence handling, credential non-disclosure, and explicit session/token invalidation rules where required by the canonical lifecycle contract.

## 5. Exit criteria

`AUTH-004` may be promoted only after the required API/DTO/entity/field/persistence/security/lifecycle/event/worker/test/evidence links are authoritative and non-empty, executable verification produces durable evidence, and the final Mapping 0 validator result is tied to a commit SHA.

## 6. Gate result

`AUTH-004 = BLOCKED_NOT_GREEN`

Reason: the downstream API, credential/recovery data contracts, persistence evidence, implementation evidence, and executed security/integration evidence required by the canonical traceability chain are not yet established. Runtime/worker code must not be added merely to force this feature to GREEN.
