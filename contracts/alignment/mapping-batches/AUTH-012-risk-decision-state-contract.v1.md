# AUTH-012 Risk Decision State Contract v1.0

Status: CONTRACTED_PARTIAL / NOT GREEN
Implementation authorization: false

## 1. Purpose

Freeze the minimum executable semantic boundary for suspicious-login Risk decisions without inventing a second Risk authority or claiming runtime persistence that has not been verified.

AUTH-012 consumes the canonical Risk-domain decision. `authLogin` remains the authentication entry point; `ENT-SESSION` remains the canonical session authority.

## 2. Authority

Risk decision authority:
- Risk / Trust domain
- T20 / W06 / D1-03 at the frozen topology layer
- existing L5/L6 instances: `fraud-login-detect-01`, `risk-action-01`, `trust-decision-create-01`, `trust-state-update-01`, `risk-decision-expire-01`

The existing Risk system contract defines the decision vocabulary:

`allow | monitor | challenge | rate_limit | degrade | hold | block | review`

This vocabulary is contract-level only. It is not yet verified as a persisted database enum.

## 3. Decision identity

Every authoritative Risk decision consumed by AUTH-012 MUST be attributable to:

- `decisionId`
- `policyVersion`
- `reasonCode`
- `expiresAt`
- `requestId`

The decision MUST also resolve to the canonical risk subject and the authentication/session context from which the decision was produced. Exact persisted field IDs remain unresolved until an executable Risk entity contract is discovered or separately approved.

## 4. State semantics

The following semantic states are frozen for mapping purposes:

- `allow`: authentication may continue subject to all other authentication gates.
- `monitor`: authentication may continue while the decision is retained for monitoring/audit according to policy.
- `challenge`: required verification/step-up must occur before protected authentication/session issuance continues.
- `rate_limit`: authentication is restricted by the applicable rate-limit policy.
- `degrade`: the request continues only through the explicitly defined degraded path.
- `hold`: protected continuation is suspended pending the required policy action.
- `block`: authentication continuation is denied.
- `review`: protected continuation requires the applicable review workflow.

These meanings are mapping semantics, not implementation evidence.

## 5. Expiry and dominance

- A Risk decision with `expiresAt` in the past MUST NOT be treated as current.
- `risk-decision-expire-01` is the canonical expiry responsibility.
- A security mutation caused by Risk MUST use canonical Identity/Auth session authority.
- A Risk-triggered session revocation MUST dominate stale cache state.
- Clients MUST NOT supply, replace, downgrade, or extend an authoritative Risk decision.

## 6. AUTH-012 consumption mapping

```text
authLogin request
  -> authentication attempt context
  -> fraud-login-detect-01
  -> canonical Risk decision/action
  -> allow / monitor / challenge / rate_limit / degrade / hold / block / review
  -> authentication protection action
  -> ENT-SESSION mutation only when authorized
  -> audit / alert projection where required
```

No `AUTH-012` Risk entity or duplicate Session entity is introduced by this mapping.

## 7. Field exposure

Public authentication DTOs MUST NOT expose:

- internal risk score
- detection rules
- model features
- raw abuse signals
- internal policy implementation details
- credential material

Internal service/event bindings MAY carry the canonical decision identifiers required for traceability, subject to least-privilege access and privacy controls.

## 8. Persistence boundary

The following remain unresolved and therefore cannot be treated as runtime facts:

- canonical Risk entity ID;
- canonical Risk field IDs;
- persisted state enum;
- D1-03 table/collection;
- migration artifact/owner;
- API/event operation ID;
- DTO IDs;
- executable handler/code reference.

No ad-hoc table, duplicate Risk authority, or speculative field set is authorized to close these gaps.

## 9. Required state-transition cases

Before GREEN, executable evidence MUST prove at minimum:

1. expired decision is not accepted as current;
2. `challenge` cannot be bypassed by directly issuing a session;
3. `block` prevents protected authentication continuation;
4. client cannot override a server-side decision;
5. duplicate protection mutation is idempotent or rejected according to the canonical mutation contract;
6. Risk-triggered session revoke dominates stale cache;
7. decision is attributable to request/correlation context;
8. security mutation produces required audit evidence.

## 10. Gate

This document closes the semantic Decision/State mapping layer only.

`AUTH-012 = NOT GREEN`.

Implementation authorization remains false until Entity/Field, API/Event, DTO, Persistence/Migration, Runtime, Security E2E and Evidence Registry evidence are all reconciled.
