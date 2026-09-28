# CC-MAPPING-0-PRIV-004-POLICY-INSTANCE-ADMISSION-2026-09-27

## Status

`GOVERNANCE_BASELINE_RECONCILED / DEV_TEST_INSTANCE_AUTHORIZED / PRODUCTION_INSTANCE_PENDING`

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


## Development-only temporary policy instance — 2026-09-28

The project is explicitly authorizing a **development/test-only** PRIV-004 instance so AUTH-001 can proceed through deterministic engineering validation without fabricating a legal or compliance conclusion.

Canonical instance:

- `artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json`
- `policyId = PRIV-004-ACCOUNT-REGISTRATION-DEV-TEMP`
- `policyVersion = DEV-2026-09-28.1`
- `environment = DEVELOPMENT`
- `status = APPROVED` by internal engineering authority only
- `rule = DURATION / 63072000 seconds` (730 days)
- `effectiveTo = 2026-12-31T23:59:59Z`

Boundary:

- 730 days is an engineering test parameter, not a legal retention requirement.
- `LEGAL_AUDIT` remains the contract retention class label; it is not a jurisdiction-specific legal conclusion.
- This instance is not valid for production data or public-facing privacy/compliance claims.
- Production remains fail-closed until a real production policy authority is admitted.
- No Mapping 0 GREEN, Evidence Registry promotion, or production deployment is implied.

The temporary instance is intentionally short-lived and must be replaced before any production authorization.


## Production readiness gate — 2026-09-28

A separate production-readiness gate is now established because the existing structural admission guard intentionally permits validation of the development-only temporary instance. Structural guard PASS is therefore not equivalent to production authorization.

Control:
- Script: `scripts/priv004-production-readiness.mjs`
- Workflow: `.github/workflows/priv004-production-readiness.yml`

The production gate fails closed unless all of the following are explicitly present in repository authority state:
- canonical policy instance environment = `PRODUCTION`;
- scope binds `authRegister / ACCOUNT_REGISTRATION / LEGAL_AUDIT`;
- instance status = `APPROVED` or `ACTIVE`;
- explicit `usage.productionUse = true`;
- valid deterministic rule and effective period;
- current-commit provenance;
- admission packet status = `PRODUCTION_INSTANCE_ADMITTED`;
- admission packet production runtime authorization = `AUTHORIZED`;
- packet contains no unresolved `productionMissingInputs`;
- packet admitted instance matches the canonical policy instance version and rule mode.

This gate does not choose a retention duration, fixed-until date, jurisdiction, legal interpretation, or approval source. With the current development-only instance it is expected to remain BLOCKED.

The production gate also enforces the structural fields already required by the admission contract before a production instance can pass: non-empty policy identity, owner, sourceAuthority, approvalRef and rollback/retirement path; non-empty scope with `authRegister / ACCOUNT_REGISTRATION / PRODUCTION`; explicit deterministic rule; current-commit provenance; and a packet admittedInstance whose policy identity/version/rule matches the canonical instance. A malformed `productionMissingInputs` value is rejected rather than treated as an empty list.
