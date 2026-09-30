# CC-MAPPING-0-CURSOR-PACKAGE-SUPERSESSION-2026-09-28

## Status

`RECONCILED_GOVERNANCE_ONLY`

## Purpose

Provide the explicit Change Control referenced by the merged PR that superseded the earlier AUTH-003 cursor package.

This control is governance-only. It does not change any Blueprint, Contract, API, DTO, Entity, Field, Worker, D1, Queue, migration, runtime, or Evidence status.

## Authority

The dedicated current-execution cursor is:

`artifacts/mapping-0/current-execution-cursor-2026-09-27.json`

It explicitly declares:

- `status = CURRENT_CURSOR_AUTHORITATIVE`
- `currentCursor.id = AUTH-001-REGISTRATION-CLOSURE`
- `currentCursor.state = BLOCKED_PRIV004_POLICY_INSTANCE`

Therefore the earlier AUTH-003 cursor package is historical governance evidence and is superseded as the active work-selection instruction.

## Superseded control

`docs/change-control/CC-MAPPING-0-CURRENT-CURSOR-SUPERSESSION-AUTH-003-2026-09-27.md`

Its historical findings remain preserved. Its earlier AUTH-003 "current execution authority" wording must not be used to select present work.

## Current gate

The active gate is:

`PRIV-004 -> admit the first approved ACCOUNT_REGISTRATION / LEGAL_AUDIT policy instance`

Required instance evidence remains:

- policy ID/version;
- authoritative scope and effective period;
- deterministic retention rule;
- approval evidence;
- rollback/retirement path;
- repository provenance.

No retention duration, fixed-until value, or jurisdiction-specific rule is inferred by this control.

## Non-authorizations

This control does not:

- authorize AUTH-001 runtime;
- reopen AUTH-003 wire/API/DTO authority;
- rerun AUTH-002/AUTH-003 PASS_VERIFIED runtime evidence;
- promote ENT-IDENTITY or ENT-CREDENTIAL;
- promote Evidence Registry or Mapping 0 GREEN;
- change Worker/D1 topology.

## Provenance

- Main reviewed: `4727e9487a3e0ac86e1eacb9c0006071d4fb95fd`
- Backup: `backup/pre-cursor-package-control-link-fix-20260928`
- Related merged PR: `#95`
