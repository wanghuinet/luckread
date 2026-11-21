# AUTH-012 Real-Evidence Reconciliation v1

- Feature: `AUTH-012`
- Name: suspicious-login detection
- Status: `BLOCKED_NOT_GREEN`
- Authority: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Mapping source: `contracts/alignment/cross-system-mapping.v1.json`
- Capability source: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`

## Current evidence

The canonical cross-system mapping currently binds `AUTH-012` to `authLogin`, but has no canonical entity, Payload collection, or code-evidence reference. Its current blocker is explicitly recorded as `risk contract remains open`.

The feature inventory and capability reconciliation identify `AUTH-012` as suspicious-login detection, but inventory/capability presence is not implementation evidence.

## Required closure chain

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

No missing identifier may be invented during reconciliation. Each identifier must be established by an authoritative contract or real repository evidence before this feature can become GREEN.

## Blocking gaps

1. Canonical suspicious-login/risk contract is not closed.
2. API/DTO request and result mapping is not evidence-bound beyond `authLogin`.
3. Risk signal/event/entity/field persistence mapping is not established.
4. Security policy and enforcement mapping is not closed.
5. Lifecycle/state transition mapping is not closed.
6. Implementation, integration/security tests, and Evidence Registry provenance are not closed.

## Admission decision

`AUTH-012` remains `BLOCKED_NOT_GREEN`. Do not mark GREEN and do not begin runtime implementation solely from the Blueprint or capability inventory.

## Next closure action

Close the risk contract first, then reconcile API/DTO/entity/field/security/lifecycle/test/evidence identifiers against real repository artifacts. Re-run the Mapping 0 validator only after evidence is present.
