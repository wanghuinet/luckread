# CC-MAPPING-0-PRIV-004-POLICY-INSTANCE-ADMISSION-2026-09-27

## Status

`GOVERNANCE_BASELINE_RECONCILED / POLICY_INSTANCE_INPUT_REQUIRED`

## Purpose

将 PRIV-004 剩余阻塞从抽象“缺少实例”转化为一个可审计、可直接提交批准输入的最小准入包。

## Governance baseline now admitted

The pre-launch privacy/data-retention governance baseline is now present on `main`:

- `docs/176-PRIVACY-DATA-RETENTION-POLICY-v0.1.md`
- `docs/change-control/CC-MAPPING-0-PRIVACY-DATA-RETENTION-POLICY-BASELINE-2026-09-27.md`
- admitted main merge: `e5d1dea7531791892831d7c3f6c00e1cf8474fac`

This baseline supplies governance structure only. It does not provide a concrete retention duration, fixed-until date, jurisdiction-specific rule, or approved policy instance.

## Current authoritative contract

`contracts/privacy/PRIV-004-retention-policy-authority.v1.json`

## Runtime binding

- Operation: `authRegister`
- Purpose: `ACCOUNT_REGISTRATION`
- Entity: `ENT-CONSENT`
- Retention class: `LEGAL_AUDIT`
- Runtime field: `ENT-CONSENT.retentionUntil`
- Stored policy reference: immutable `policyVersion`

## Required first approved instance

The first usable instance must provide:

1. `policyId`;
2. `policyVersion`;
3. owner;
4. authoritative scope;
5. environment;
6. status `APPROVED` or `ACTIVE`;
7. effectiveFrom/effectiveTo;
8. one deterministic rule:
   - `DURATION` + approved durationSeconds, or
   - `FIXED_UNTIL` + approved timestamp;
9. sourceAuthority;
10. approvalRef/evidence;
11. rollbackVersion or explicit retirement path;
12. current-commit provenance.

## Blocking rule

Until the first approved instance is admitted:

- AUTH-001 must not calculate `retentionUntil` by inference;
- the client must not select or override the retention rule;
- W01 must not persist an ENT-CONSENT record with unresolved `retentionUntil`;
- AUTH-001 runtime implementation remains blocked;
- no runtime Evidence Registry promotion is permitted.

## Explicit non-decisions

This packet does not select:

- a retention duration;
- a fixed-until date;
- a jurisdiction-specific legal requirement.

Those values must arrive through the authoritative approval input.

## Machine-readable packet

`artifacts/mapping-0/priv004-policy-instance-admission-packet-2026-09-27.json`

## Next Gate

`PRIV-004::admit the first approved ACCOUNT_REGISTRATION / LEGAL_AUDIT policy instance with version, scope, effective period, deterministic rule, approval and provenance evidence.`


## Authority discovery checkpoint — 2026-09-27

A repository-only authority search was performed before runtime implementation was considered. The search covered:

- docs/160-DATA-LIFECYCLE-RETENTION-ERASURE-CONTRACT-v1.0.md
- docs/175-FEATURE-FLAG-CONFIG-POLICY-VERSIONING-CONTRACT-v1.0.md
- contracts/privacy/PRIV-004-retention-policy-authority.v1.json
- AUTH-001 / PRIV-002 change-control and reconciliation records
- Foundation implementation plan and Blueprint references for PRIV-004
- Mapping 0 privacy reconciliation batch
- repository-wide searches for ACCOUNT_REGISTRATION, LEGAL_AUDIT, retentionUntil, policyVersion, approval, and policy-instance records

Result: no approved/active concrete PRIV-004 policy instance was found in the repository. The newly admitted Privacy / Data Retention Policy v0.1 is a governance baseline and is explicitly not treated as a concrete policy instance.

This is an authority-discovery checkpoint only. It does not authorize a retention duration, fixed-until date, jurisdiction-specific rule, or runtime behavior. Repeating the same repository-only search without a new authoritative source is not a new implementation gate.
