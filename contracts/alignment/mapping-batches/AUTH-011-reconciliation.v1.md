# AUTH-011 Real-Evidence Reconciliation v1

- Feature: `AUTH-011` — token lifecycle and rotation
- Status: `BLOCKED_NOT_GREEN`
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Mapping source: `contracts/alignment/cross-system-mapping.v1.json`

## Current evidence

The canonical mapping binds `AUTH-011` to `authRefresh` and security ID `user.session.refresh`, but has no entity, Payload collection, or code-evidence references. The explicit blocker is incomplete refresh OpenAPI/DTO/state/security/test evidence.

## Blocking gaps

1. Refresh request/result DTO and OpenAPI contract evidence is incomplete.
2. Refresh credential/session state persistence mapping is missing.
3. Rotation, replay resistance, revocation, expiry, and reuse-detection semantics require evidence closure.
4. Security authorization and account-state interaction are not fully mapped.
5. Integration/security tests and Evidence Registry provenance are not closed.

## Admission decision

`AUTH-011` remains `BLOCKED_NOT_GREEN`; the presence of `authRefresh` alone is insufficient for GREEN.

## Next closure action

Reconcile refresh-token/credential lifecycle against the authoritative identity/session registry and real repository artifacts, bind the full traceability chain, then rerun the fail-closed Mapping 0 validator.
