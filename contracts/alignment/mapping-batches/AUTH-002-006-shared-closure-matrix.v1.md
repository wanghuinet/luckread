# AUTH-002–AUTH-006 Shared Closure Matrix v1.0

## Status

`NOT_GREEN / IMPLEMENTATION_PENDING`

## Purpose

Collapse the shared downstream closure work for AUTH-002 through AUTH-006 into one fail-closed matrix. This document does not promote any feature to GREEN without executable evidence.

## Authority

- Blueprint: `docs/00-LUCKREAD-BLUEPRINT-CLOSURE-v3.0.md`
- Feature inventory: `contracts/alignment/feature-inventory.v1.json`
- Auth API policy: `contracts/api/auth-operation-policy.v1.json`
- B01 reconciliation: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Entity catalog: `contracts/entity/entity-catalog.v1.json`
- Entity field contract: `contracts/entity/entity-field-contract.v1.json`

## Fail-closed rule

`DEFINED != MAPPED != IMPLEMENTED != VERIFIED != GREEN`.

A missing, inferred, stale, or unexecuted reference keeps the affected feature non-green.

## Shared closure dimensions

Every sensitive authentication feature must establish, as applicable:

1. canonical API operation IDs;
2. request/response DTO IDs;
3. authoritative entity IDs;
4. authoritative field IDs;
5. permission/scope IDs;
6. lifecycle/state mapping;
7. event IDs;
8. D1 domain/table/column/migration mapping;
9. runtime implementation evidence;
10. positive and negative integration/security test evidence;
11. Evidence Registry IDs;
12. final Mapping 0 validator result bound to the tested commit SHA.

## Feature matrix

### AUTH-002 — Login / Logout

Current: `BLOCKED_NOT_GREEN`.

Required closure:

- bind `authLogin` and `authLogout` to canonical DTO/entity/field references;
- verify Session persistence using the existing AUTH-002 Session Field Contract;
- capture controlled remote D1 schema/migration evidence;
- prove account-state enforcement;
- prove login security controls and logout revocation semantics;
- execute integration and negative-path tests;
- register durable Evidence Registry entries;
- run final mapping validation against the same commit SHA.

### AUTH-003 — Username / Email / Phone Credentials

Current: `BLOCKED_NOT_GREEN`.

Required closure:

- establish canonical credential-management API operation IDs;
- establish public/request DTO IDs;
- establish authoritative Identity/Credential entities or prove an existing entity is sufficient;
- freeze username/email/phone field IDs and deterministic normalization rules;
- bind uniqueness and persistence constraints;
- bind authorization scope and lifecycle state;
- implement and execute normalization, uniqueness, enumeration-resistance and credential non-disclosure tests;
- register Evidence IDs;
- run final mapping validation.

### AUTH-004 — Password Reset / Change

Current: `BLOCKED_NOT_GREEN`.

Required closure:

- establish canonical reset/change API and DTO IDs;
- bind credential and recovery-token entities/fields;
- bind authorization boundaries;
- bind single-use/time-bounded token lifecycle;
- define credential/session invalidation semantics;
- execute replay, expiry, enumeration and secret-protection tests;
- register Evidence IDs;
- run final mapping validation.

### AUTH-005 — Email / Phone Verification

Current: `BLOCKED_NOT_GREEN`.

Required closure:

- establish canonical verification API/DTO IDs;
- establish verification challenge/token entity and field IDs;
- bind token hash, expiry, purpose and identity persistence;
- bind account lifecycle state changes;
- execute single-use, concurrency, expiry, wrong-purpose and security tests;
- register Evidence IDs;
- run final mapping validation.

### AUTH-006 — Passkey / WebAuthn

Current: `BLOCKED_NOT_GREEN`.

Required closure:

- establish canonical API and DTO IDs;
- establish passkey credential and challenge entities/fields;
- define origin/RP-ID authority;
- define challenge single-use and replay state;
- bind account-state and permission checks;
- bind D1 persistence and migration evidence;
- implement registration/assertion verification;
- execute positive and negative security/integration tests;
- register Evidence IDs;
- run final mapping validation.

## Shared implementation boundary

No feature in this matrix may be promoted by changing only status fields. Promotion requires evidence from the actual runtime, persistence, tests and validator.

## Evidence requirements

Evidence must be:

- produced by executable verification;
- tied to an exact commit SHA;
- tied to the intended repository and environment;
- non-empty;
- reproducible where applicable;
- referenced by the mapping record.

Documentation-only references, registry validation-unit names, framework feature presence, generated types, or historical configuration do not count as execution evidence.

## Batch gate

The batch remains `NOT_GREEN` until every selected feature has complete authoritative traceability and executable evidence. Once AUTH-002 through AUTH-006 are independently green, rerun the B01 mapping validator and verify that no downstream record remains PARTIAL/MISSING for these features.
