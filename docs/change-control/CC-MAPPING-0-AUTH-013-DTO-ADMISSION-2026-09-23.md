# AUTH-013 DTO Admission — 2026-09-23

- Feature: `AUTH-013`
- Operation: `transitionAccountState`
- Status: `CONTRACT_BOUND / VERIFICATION_PENDING`
- Entity: `ENT-USER`

## Canonical DTO bindings

The existing OpenAPI operation already defines the request and response bodies for `transitionAccountState`. These stable DTO identifiers now bind directly to those existing schemas:

| Direction | DTO ID | OpenAPI schema |
|---|---|---|
| Request | `DTO-AUTH-013-ACCOUNT-STATE-TRANSITION-REQUEST` | `#/paths/~1users~1{userId}~1account-state/post/requestBody/content/application~1json/schema` |
| Response | `DTO-AUTH-013-ACCOUNT-STATE-TRANSITION-RESPONSE` | `#/paths/~1users~1{userId}~1account-state/post/responses/200/content/application~1json/schema` |

The admitted request remains the existing `to` + `reason` body. The admitted response remains the existing `from` + `to` + `auditEventId` body.

No new endpoint, field semantics, error enum, or authorization rule is introduced by this admission.

## Evidence boundary

This admission proves only Contract/DTO binding. It does not prove runtime implementation, persistence, authorization execution, audit/event emission, or security behavior.

AUTH-013 therefore remains non-green.
