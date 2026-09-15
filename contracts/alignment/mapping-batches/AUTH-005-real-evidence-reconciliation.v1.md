# AUTH-005 Real-Evidence Reconciliation v1.0

- Feature: `AUTH-005`
- Name: email/phone verification
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability contract: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Entity authority: `contracts/entity/entity-catalog.v1.json`
- Field authority: `contracts/entity/entity-field-contract.v1.json`

## 1. Confirmed contract evidence

1. The Blueprint and feature inventory define `AUTH-005` as email/phone verification.
2. The B01 reconciliation contract defines the behavior as consuming a valid verification challenge and updating the existing account lifecycle.
3. The B01 contract requires verification tokens to be single-use, time-bounded, and bound to the intended identity and purpose.
4. The identity/session registry contains explicit validation units for issuing, hashing, expiring and consuming verification tokens, plus email ownership and email binding controls. These are contract/verification claims, not execution evidence.
5. The B01 contract already binds `AUTH-005` to the authoritative account state machine at the capability level, but does not supply the complete API/event/persistence implementation chain.
6. The current verified entity inventory does not establish a verified verification-token or credential-identity entity with complete field mapping.

## 2. Missing canonical traceability

- Canonical verification API operation ID(s): missing.
- Verification request/response DTO IDs: missing.
- Verification challenge/token entity ID: missing.
- Email/phone verification field IDs: missing.
- Token hash and expiry persistence mapping: missing.
- Intended identity/purpose binding persistence mapping: missing.
- Account lifecycle/state transition mapping: incomplete.
- Verification success/failure event IDs: missing.
- Worker/runtime implementation evidence: missing.
- D1 domain/table/column/migration evidence: unresolved.
- Executed tests for expiry, single-use, replay, concurrency and wrong-purpose rejection: missing.
- Security E2E evidence for account-enumeration resistance and secret non-disclosure: missing.
- Evidence Registry IDs bound to `AUTH-005`: missing.

## 3. Evidence interpretation rules

The registry validation-unit names `issue-verification-token-01`, `hash-verification-token-01`, `expire-verification-token-01`, and `consume-verification-token-01` are not executable evidence. No API handler, storage schema, token field, event, worker, or test result is promoted from those names alone.

## 4. Security and consistency gate

`AUTH-005` cannot become GREEN until the canonical flow proves that verification material is stored safely, raw secrets are not persisted or logged, tokens expire deterministically, each valid token can be consumed at most once even under concurrency, token purpose and identity are enforced, and protected account existence is not disclosed through verification responses.

## 5. Exit criteria

`AUTH-005` may be promoted only after the complete traceability chain is authoritative and non-empty across API, DTO, entity, field, persistence, security, lifecycle, event, worker, tests and evidence, with executable results bound to a commit SHA and accepted by the fail-closed Mapping 0 validator.

## 6. Gate result

`AUTH-005 = BLOCKED_NOT_GREEN`

Reason: the repository currently contains capability and registry contracts but not the authoritative executable implementation, persistence mapping, security/integration execution evidence, or Evidence Registry binding required for GREEN.
