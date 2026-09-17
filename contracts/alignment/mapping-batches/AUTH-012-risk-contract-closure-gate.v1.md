# AUTH-012 Risk Contract Closure Gate v1.1

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Scope

AUTH-012 = suspicious-login detection.

Canonical operation currently referenced by the feature/capability inventory: `authLogin`.
The feature is not considered implemented merely because `authLogin` exists in API policy. Inventory and capability presence are planning evidence, not runtime evidence.

## Authority boundary

- Identity / Account authority remains in the Identity / Account domain.
- Session authority remains in Identity / Auth and canonical `ENT-SESSION`.
- Risk decision authority remains in the Risk domain, mapped to T20/W06/D1-03 at the frozen topology layer.
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

The current Risk contract defines the required decision vocabulary as `allow`, `monitor`, `challenge`, `rate_limit`, `degrade`, `hold`, `block`, and `review`. These values are contract vocabulary only; they are not yet a verified persisted state enum for a runtime entity.

### Protection actions

Depending on the canonical risk decision, the system may require verification/step-up, reject or restrict authentication, revoke affected session state, or continue while generating an alert. Exact runtime state/action persistence semantics remain unverified.

### User-facing security data

Security Center may expose facts, risk notices, and recommended actions, but must not expose passwords, tokens, recovery secrets, internal risk scores, detection rules, or unnecessary network/device details.

### Audit

A suspicious-login decision that causes a security mutation must be attributable to a server-side request/correlation context and an audit record. Audit evidence must be execution-backed before GREEN.

## Repository reconciliation result

The repository has an explicit canonical Risk/Trust instance registry with the following L5/L6 responsibilities relevant to AUTH-012:

- `fraud-login-detect-01` — detect suspicious login;
- `risk-case-id-01` — generate risk case ID;
- `risk-subject-resolve-01` — resolve risk subject;
- `risk-policy-resolve-01` — resolve risk policy;
- `risk-score-01` — calculate risk score;
- `risk-level-classify-01` — classify risk level;
- `risk-action-01` — apply risk action;
- `trust-decision-create-01` — create trust decision;
- `trust-state-update-01` — update trust state;
- `risk-decision-expire-01` — expire risk decision.

The separate Identity/Session registry also contains the login-risk and protection boundaries:

- `login-event-01`;
- `known-device-compare-01`;
- `login-risk-aggregate-01`;
- `impossible-travel-boundary-01`;
- `login-challenge-01`;
- `takeover-escalation-01`;
- `compromised-session-revoke-01`.

These are authoritative L5/L6 contract surfaces, but their implementation state is `IMPLEMENTATION-PENDING / CL-CI-NOT-RUN`; therefore they do not constitute runtime evidence.

## Entity / field / persistence reconciliation

Search of current repository contracts found a fully defined and verified Risk entity schema, concrete Risk persistence collection/table, Risk DTO binding, and executable Risk runtime handler **not established** for AUTH-012.

The repository does contain canonical `ENT-SESSION` field contract material, but that is the Session authority and must not be repurposed as the Risk decision entity. Its contract explicitly rejects speculative risk score/IP/geolocation/fingerprint fields until separately contracted.

Therefore the following identifiers remain intentionally unresolved:

```text
Risk entity ID             = UNRESOLVED
Risk field IDs             = UNRESOLVED
Risk state enum persistence = UNRESOLVED
Risk D1-03 table/collection = UNRESOLVED
Risk migration owner       = UNRESOLVED
Risk DTO IDs               = UNRESOLVED
Risk API/event operation ID= UNRESOLVED
Runtime handler/code ref   = UNRESOLVED
```

No new Risk entity, duplicate session entity, or ad-hoc persistence table is authorized merely to fill these gaps.

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

## Current gate

AUTH-012 remains `BLOCKED_NOT_GREEN`.

Next closure stage is to freeze the executable Risk decision/state contract using the existing `fraud-login-detect-01` / `risk-action-01` / `trust-decision-create-01` authority, then bind its API/event, DTO, persistence/migration, lifecycle, security tests, and Evidence Registry records.

Implementation must not begin from this gate alone.
