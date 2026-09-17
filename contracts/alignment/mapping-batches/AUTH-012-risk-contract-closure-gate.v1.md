# AUTH-012 Risk Contract Closure Gate v1.0

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Scope

AUTH-012 = suspicious-login detection.

Canonical operation currently referenced by the feature/capability inventory: `authLogin`.
The feature is not considered implemented merely because `authLogin` exists in API policy. Inventory and capability presence are planning evidence, not runtime evidence.

## Authority boundary

- Identity / Account authority remains in the Identity / Account domain.
- Session authority remains in Identity / Auth.
- Risk decision authority remains in the Risk domain.
- Notification delivery remains in the Notification domain.
- Security Center is an experience surface and must not create a second Risk authority.

The Security Center contract defines the suspicious-login journey as:
`Detection → Alert → Verify → Protect → Revoke/Continue → Audit`.
It also requires that sensitive mutations have request/correlation/idempotency/audit controls and that clients cannot become the security-state authority.

## Minimum canonical contract

### Detection input

A suspicious-login decision may consume server-observable authentication/session signals already available to the authoritative auth pipeline, including authentication outcome, session/device context, account state, and other explicitly contracted risk signals.

No undocumented client-provided risk score, trust score, or detection-rule result may be authoritative.

### Decision output

The Risk domain must produce an explicit decision state sufficient for the auth pipeline to choose an allowed protection action. Internal risk scores and detection rules are not public API fields.

### Protection actions

Depending on the canonical risk decision, the system may require verification/step-up, reject or restrict authentication, revoke affected session state, or continue while generating an alert. Exact action values must be frozen before implementation.

### User-facing security data

Security Center may expose facts, risk notices, and recommended actions, but must not expose passwords, tokens, recovery secrets, internal risk scores, detection rules, or unnecessary network/device details.

### Audit

A suspicious-login decision that causes a security mutation must be attributable to a server-side request/correlation context and an audit record. Audit evidence must be execution-backed before GREEN.

## Required cross-system mapping

Before implementation authorization:

1. API operation/event surface is canonical.
2. Risk decision entity/state is canonical or an existing authoritative risk contract is referenced.
3. Input fields have explicit source and trust boundary.
4. Output/action state has explicit consumer and authority.
5. DTO exposure excludes internal risk score/rules.
6. Session mutation maps to `ENT-SESSION` rather than creating a second session entity.
7. Permission/step-up requirements are explicit for every sensitive action.
8. Persistence authority and migration are identified.
9. Security E2E cases are defined.
10. Evidence Registry contains executable evidence; an empty Evidence Registry cannot pass.

## Mandatory security cases

- Authentication error does not disclose account existence.
- A client cannot submit or override a server-authoritative risk decision.
- Cross-account session mutation is rejected.
- A risk-triggered revoke dominates stale cache.
- Step-up cannot be bypassed by replaying an earlier request.
- Duplicate security mutation is idempotent or safely rejected according to the canonical mutation contract.
- Audit evidence is generated for risk-triggered security mutation.

## Current blockers

- Canonical Risk entity/state/action contract is not yet mapped.
- Canonical API/event surface for suspicious-login detection is not yet closed.
- DTO bindings are not yet closed.
- Persistence and migration authority are not yet closed.
- Executable security E2E evidence is absent.
- Evidence Registry execution evidence is absent.

## Gate

AUTH-012 remains `BLOCKED_NOT_GREEN` until the above blockers are closed and execution-backed evidence exists. No runtime implementation should be promoted to canonical merely because a planning document or API inventory entry exists.
