# P0 Authorization Contract CI Gate v1.0

## Objective

Convert the authorization hardening contract into an executable repository gate.

## Required CI stages

```text
AUTHZ_ARTIFACT_EXISTS
  ↓
AUTHZ_JSON_PARSE
  ↓
AUTHZ_SCHEMA_CONTRACT
  ↓
AUTHZ_SUBJECT_TYPES
  ↓
AUTHZ_PROTECTED_FIELDS
  ↓
AUTHZ_DENY_PRECEDENCE
  ↓
AUTHZ_STATIC_BYPASS_SCAN
  ↓
AUTHZ_E2E_NEGATIVE
  ↓
AUTHZ_E2E_POSITIVE
  ↓
AUTHZ_CONCURRENCY
  ↓
AUTHZ_EVIDENCE
```

## Static gate

`node scripts/contract-authz-check.mjs` is the minimum contract gate.

It MUST fail when:

- required authorization artifacts are missing;
- JSON is invalid;
- mandatory authorization checks are missing;
- deny precedence is not fail-closed;
- subject types are incomplete;
- protected fields are absent;
- known direct role-admin bypass patterns are introduced;
- obvious request-body mass-assignment patterns are introduced.

## E2E gate

Static analysis is insufficient for Security Green.

CI MUST eventually execute the matrix from:

`docs/13-P0-AUTHORIZATION-E2E-MATRIX-v1.0.md`

The minimum security suite must prove:

```text
IDOR = DENY
CROSS_TENANT = DENY
PRIVILEGE_ESCALATION = DENY
FIELD_INJECTION = DENY
STALE_PERMISSION = DENY
REVOKED_DELEGATION = DENY
SUSPENDED_ACCOUNT = DENY
UNDECLARED_SERVICE_SCOPE = DENY
```

and valid owner/scoped/entitled requests remain ALLOW.

## Evidence rule

The CI summary MUST distinguish:

```text
CONTRACT_GREEN
IMPLEMENTATION_GREEN
E2E_GREEN
SECURITY_GREEN
```

One Green MUST NOT imply another.

Missing evidence is failure, not unknown success.

## Current status

```text
CONTRACT_GATE: DEFINED
STATIC_GATE: IMPLEMENTED
E2E_GATE: CONTRACTED
SECURITY_GREEN: BLOCKED_UNTIL_E2E
```
