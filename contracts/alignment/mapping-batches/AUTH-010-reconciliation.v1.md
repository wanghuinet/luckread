# AUTH-010 Real-Evidence Reconciliation v1

- Feature: `AUTH-010` — session/device management
- Status: `BLOCKED_NOT_GREEN`
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Mapping source: `contracts/alignment/cross-system-mapping.v1.json`

## Current evidence

The canonical mapping has `authSessionList` and `authSessionRevoke`, with security IDs `user.session.read` and `user.session.revoke`. It still has no entity, Payload collection, or code-evidence references. The blocker is incomplete page/DTO/entity/field/event/Worker/D1/test/evidence reconciliation.

## Blocking gaps

1. Session/device DTOs and result contracts are not fully bound.
2. Session/device entity and field persistence mapping is not established.
3. Session list/revoke security enforcement and current-user scope need evidence closure.
4. Session lifecycle events and revocation semantics require repository evidence.
5. Integration/security tests and Evidence Registry provenance are missing.

## Admission decision

`AUTH-010` remains `BLOCKED_NOT_GREEN` despite having two canonical operation IDs.

## Next closure action

Reconcile the existing session/device contract and identity registry against real code and persistence evidence, then rerun the fail-closed Mapping 0 validator.
