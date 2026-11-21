# Change Control: AUTH-004 OpenAPI Discovery Shell Conflict — 2026-09-26

- Change Control ID: `CC-MAPPING-0-AUTH-004-OPENAPI-DISCOVERY-SHELL-CONFLICT-2026-09-26`
- Status: `APPROVED_RECONCILIATION / AUTHORITY_ONLY`
- Parent checkpoint: `e9257c3ce9a6cdaf497a49a32fdf526267fc2161`
- Backup: `backup/main-before-auth004-openapi-discovery-conflict-20260926`

## Finding

Two non-equivalent AUTH-004 API authority representations exist in the repository.

### Feature API contract

`contracts/api/AUTH-004-password-recovery-contract.v1.json` defines:

- `authPasswordChange` — `POST /auth/password/change`
- `authPasswordResetRequest` — `POST /auth/password/reset/request`
- `authPasswordResetConfirm` — `POST /auth/password/reset/confirm`

### Existing API Inventory / OpenAPI discovery shell

The existing discovery surface contains:

- `postAccountPasswordChange` — `POST /account/password/change`
- `postAccountRecovery` — `POST /account/recovery`

Those OpenAPI operations are explicitly marked `x-luckread-contract-status: DISCOVERY_DRAFT`, sourced from `contracts/api/api-inventory.v1.json`, and do not contain an admitted request/response schema.

## Why this is a real authority conflict

The two surfaces differ in:

- operationId vocabulary;
- path vocabulary;
- decomposition of password recovery into change vs request vs confirm operations;
- OpenAPI admission status.

The discovery shell therefore cannot be treated as equivalent canonical AUTH-004 API evidence.

## Required decision

A formal authority decision must establish the canonical public route/operation decomposition before any OpenAPI promotion or DTO admission.

The decision must explicitly resolve:

1. whether the feature contract or discovery inventory is authoritative for AUTH-004 public paths;
2. whether `/auth/password/change` and `/auth/password/reset/*` replace the discovery paths, or whether the discovery surface is canonical;
3. whether `postAccountPasswordChange` / `postAccountRecovery` remain historical aliases only;
4. exact mapping of AUTH-004 three operations to canonical OpenAPI operationIds.

## Explicit non-actions

This control does not:

- rename existing operations;
- delete discovery routes;
- add OpenAPI request/response schemas;
- change the AUTH-004 API contract;
- promote DTO registry records;
- authorize runtime implementation;
- create Evidence Registry claims.

## Current result

`BLOCKED_DECISION_REQUIRED`

The discovery shell is retained as decision material. No automatic normalization is authorized.


## Decision outcome

The feature-specific AUTH-004 API contract is the authoritative target source for canonical route and operation decomposition. The existing `postAccountPasswordChange` and `postAccountRecovery` entries remain historical/discovery aliases only; both remain `DISCOVERY_DRAFT` and are not promoted into the canonical AUTH-004 operation set.

This decision does not modify the OpenAPI document. Exact request/response schemas remain a separate gate.

Result: `PASS_VERIFIED_AUTHORITY_ONLY`.
