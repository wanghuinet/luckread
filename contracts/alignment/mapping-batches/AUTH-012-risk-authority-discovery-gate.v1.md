# AUTH-012 Risk Authority Discovery Gate v1.0

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Purpose

Freeze the result of repository-level discovery for AUTH-012 (suspicious-login detection) before any runtime Risk implementation is introduced.

## Discovery result

The current repository contains:

- `SAFETY-012` as a blueprint feature for trust/risk scoring.
- A separate safety batch describing account risk state, safety policy decision, enforcement action, and related safety capabilities.
- Historical archived capability matrices describing `17.5 Risk actions`, including allow/throttle/quarantine/block/escalation decisions.
- The Security Center contract defining suspicious-login as `Detection -> Alert -> Verify -> Protect -> Revoke/Continue -> Audit`.

However, repository search did **not** identify an active canonical contract that freezes a Risk decision/state entity, executable Risk API/event surface, authoritative persistence model, or DTO/field contract for the AUTH-012 login path.

The historical `docs/archive/1.0-reuse/*` material is reference-only and MUST NOT be promoted to runtime authority without an explicit current contract.

## Consequence for AUTH-012

AUTH-012 remains `CONTRACTED_PARTIAL / NOT GREEN`.

The current `authLogin` policy may retain the documented action vocabulary (`ALLOW`, `THROTTLE`, `CHALLENGE`, `BLOCK`) as policy requirements, but these values MUST NOT be treated as a persisted Risk entity/state contract until the canonical Risk authority is frozen.

No new Risk entity, duplicate session entity, or ad-hoc persistence table is authorized by this gate.

## Required closure sequence

1. Identify or explicitly establish the canonical Risk authority for login-risk decisions.
2. Freeze the decision input/trust boundary and output state/action contract.
3. Bind the decision to `ENT-SESSION` without creating a second session authority.
4. Freeze permission and step-up requirements for sensitive security actions.
5. Freeze persistence, migration, DTO, API/event, and lifecycle bindings.
6. Add executable security/integration evidence for enumeration resistance, client decision override rejection, cross-account mutation rejection, stale-cache revoke dominance, step-up replay prevention, and idempotent mutation.
7. Register all closure evidence in the Evidence Registry before any GREEN state is allowed.

## Non-goals

This gate does not create a Risk runtime, database schema, API route, or implementation stub. It records the current evidence boundary so subsequent implementation cannot silently invent an authority.

## Evidence

- `contracts/api/auth-operation-policy.v1.json` — current `authLogin` policy and missing Risk/anti-abuse evidence.
- `docs/149-SECURITY-CENTER-EXPERIENCE-CONTRACT-v1.0.md` — security-center authority boundary and suspicious-login journey.
- `contracts/alignment/feature-inventory.v1.json` — `SAFETY-012` discovery state.
- `contracts/capability/reconciliation-batches/U-safety.v1.json` — safety capability inventory.
- `docs/archive/1.0-reuse/RECOVERED-35-THIRD-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` — historical Risk action vocabulary; reference only.
- `docs/archive/1.0-reuse/RECOVERED-36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` — historical Risk action vocabulary; reference only.
