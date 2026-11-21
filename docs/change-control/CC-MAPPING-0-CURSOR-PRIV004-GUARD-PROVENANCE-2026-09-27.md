# CC-MAPPING-0-CURSOR-PRIV004-GUARD-PROVENANCE-2026-09-27

## Status

`CURSOR_RECONCILED / NOT_GREEN`

## Scope

Synchronize the authoritative Mapping 0 execution cursor with the current `main` head after the existing PRIV-004 admission guard and current-commit provenance control were merged.

## Reconciliation

- Previous cursor source head: `e5d1dea7531791892831d7c3f6c00e1cf8474fac`
- Current main head: `b575603f04d2167b72b41624570d0ccf14af7159`
- Active cursor remains: `AUTH-001-REGISTRATION-CLOSURE`
- Active state remains: `BLOCKED_PRIV004_POLICY_INSTANCE`
- Active next gate remains the first approved `ACCOUNT_REGISTRATION / LEGAL_AUDIT` PRIV-004 policy instance.
- The newly merged guard and workflow are added as supporting controls only.

## Boundary

This reconciliation:

- does not admit a concrete retention policy instance;
- does not select duration or FIXED_UNTIL;
- does not infer a jurisdiction-specific rule;
- does not authorize AUTH-001 runtime;
- does not change Worker/D1 topology;
- does not promote Evidence Registry or Mapping 0 GREEN;
- does not rerun previously verified runtime evidence.

## Evidence / Control References

- `docs/change-control/CC-MAPPING-0-PRIV-004-ADMISSION-GUARD-2026-09-27.md`
- `.github/workflows/priv004-policy-instance-admission.yml`
- `scripts/priv004-policy-instance-admission.mjs`
- `artifacts/mapping-0/priv004-policy-instance-admission-packet-2026-09-27.json`

## Decision

The cursor is current with `main`. The execution queue must remain blocked at the existing PRIV-004 approved-policy-instance gate until a real authoritative approval input is supplied.
