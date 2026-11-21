# AUTH-012 Risk Authority Discovery Gate v1.1

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Purpose

Freeze the repository-level discovery result for AUTH-012 (suspicious-login detection) before any runtime Risk implementation is introduced.

## Discovery result

The repository now contains a current, non-archived Risk / Trust instance registry:

- `docs/190-L5-L6-RISK-MODERATION-RIGHTS-INSTANCE-REGISTRY-v1.0.md`
- L5 `fraud-login-detect-01` under the L4 capability `detect suspicious login`.
- L6 minimum claim: signal attribution and policy-version recording.
- The same registry defines `risk-case-id-01`, `risk-subject-resolve-01`, `risk-policy-resolve-01`, `risk-score-01`, `risk-level-classify-01`, `risk-action-01`, `trust-decision-create-01`, `trust-state-update-01`, and `risk-decision-expire-01` as the surrounding Risk / Trust contract surface.
- The registry explicitly states that Risk scores/model outputs are decisions/inputs and do not replace canonical account/content/rights authority.
- The registry explicitly requires durable, scope-bounded risk actions and auditable policy/version references.
- The registry remains `IMPLEMENTATION-PENDING / CL-CI-NOT-RUN`; therefore it is a contract boundary, not runtime evidence.

The Security Center contract continues to define suspicious-login as `Detection -> Alert -> Verify -> Protect -> Revoke/Continue -> Audit`.

Historical `docs/archive/1.0-reuse/*` material remains reference-only and MUST NOT be promoted to runtime authority.

## AUTH-012 canonical binding discovered

AUTH-012 is now bound to the current Risk registry as follows:

```text
AUTH-012 suspicious-login detection
  -> L4 detect suspicious login
  -> L5 fraud-login-detect-01
  -> signal attribution + policy version
  -> Risk decision/action surface
  -> authLogin security pipeline
  -> ENT-SESSION only after an allowed authentication outcome
```

This binding does NOT yet freeze a concrete persisted Risk entity ID, API/event operation ID, DTO ID, or storage table. Those remain closure requirements because the current registry does not provide those executable bindings.

## Consequence for AUTH-012

AUTH-012 remains `CONTRACTED_PARTIAL / NOT GREEN`.

The current `authLogin` policy may retain the documented action vocabulary (`ALLOW`, `THROTTLE`, `CHALLENGE`, `BLOCK`) as policy requirements. These values are not promoted to a persisted Risk entity/state contract until the executable decision/state binding is frozen.

No new Risk entity, duplicate session entity, or ad-hoc persistence table is authorized by this gate.

## Required closure sequence

1. Freeze the executable Risk decision/state authority behind `fraud-login-detect-01` and `risk-action-01`.
2. Freeze the decision input/trust boundary and output state/action contract.
3. Bind the decision to `ENT-SESSION` without creating a second session authority.
4. Freeze permission and step-up requirements for sensitive security actions.
5. Freeze persistence, migration, DTO, API/event, and lifecycle bindings.
6. Add executable security/integration evidence for enumeration resistance, client decision override rejection, cross-account mutation rejection, stale-cache revoke dominance, step-up replay prevention, and idempotent mutation.
7. Register all closure evidence in the Evidence Registry before any GREEN state is allowed.

## Non-goals

This gate does not create a Risk runtime, database schema, API route, or implementation stub. It records the current evidence boundary so subsequent implementation cannot silently invent an authority.

## Evidence

- `docs/190-L5-L6-RISK-MODERATION-RIGHTS-INSTANCE-REGISTRY-v1.0.md` — current Risk / Trust L5/L6 instance boundary; implementation pending.
- `contracts/api/auth-operation-policy.v1.json` — current `authLogin` policy and missing executable Risk/anti-abuse evidence.
- `docs/149-SECURITY-CENTER-EXPERIENCE-CONTRACT-v1.0.md` — security-center authority boundary and suspicious-login journey.
- `contracts/alignment/feature-inventory.v1.json` — `SAFETY-012` discovery state.
- `contracts/capability/reconciliation-batches/U-safety.v1.json` — safety capability inventory.
- `docs/archive/1.0-reuse/RECOVERED-35-THIRD-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` — historical Risk action vocabulary; reference only.
- `docs/archive/1.0-reuse/RECOVERED-36-FOURTH-LEVEL-CAPABILITY-MASTER-MATRIX-v1.0.md` — historical Risk action vocabulary; reference only.
