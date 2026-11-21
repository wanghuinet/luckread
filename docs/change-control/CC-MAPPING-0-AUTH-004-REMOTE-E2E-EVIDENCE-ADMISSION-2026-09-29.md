# CC-MAPPING-0-AUTH-004-REMOTE-E2E-EVIDENCE-ADMISSION-2026-09-29

## Status

`EVIDENCE_ADMITTED / FEATURE_NOT_GREEN`

## Scope

Admit the already-completed controlled AUTH-004 remote HTTP E2E execution into the canonical Evidence Registry and canonical Mapping 0 feature record.

This Change Control is evidence/governance-only. It does not change application runtime behavior, public wire contracts, Payload version, D1 schema, Worker topology, or entity authority.

## Authoritative execution

- Deployment workflow: `W01 W02 Auth Binding Deploy`
- Deployment run: `36455540585`
- Exact deployed application source: `7104cc3d4e29ef62f1ae59d9ed5fcca770a12f0e`
- Remote E2E workflow: `AUTH-004 Remote HTTP E2E Evidence`
- Remote E2E run: `36455724050`
- Remote E2E job: `109041444298`
- Evidence artifact: `10984999026`
- Artifact SHA-256: `cd7578a21af534567f4372c1bd44658391832a5dd3b1fddc3616198a75218b10`

## Evidence admitted

The successful controlled probe establishes, for this exact deployed scope:

1. remote AUTH-004 HTTP lifecycle execution;
2. enumeration-resistant reset-request behavior for existing vs missing controlled accounts;
3. Payload-native session semantics for password change and reset;
4. reset-token replay rejection and expiry rejection;
5. credential non-disclosure in the evidence result.

Canonical Evidence Registry records added:

- `EVD-AUTH004-B12-REMOTE-HTTP-E2E-001`
- `EVD-AUTH004-B12-PROTECTED-ACCOUNT-ENUMERATION-001`
- `EVD-AUTH004-B12-SESSION-LIFECYCLE-REMOTE-001`

## Promotion boundary

This admission does **not** promote:

- AUTH-004 to GREEN;
- ENT-CREDENTIAL / ENT-SESSION / ENT-VERIFICATION;
- canonical Mapping 0;
- Five-Way Alignment;
- lifecycle event authority/evidence.

The remaining AUTH-004 blockers are lifecycle-event evidence and final canonical Mapping 0 / Five-Way admission.

## Non-actions

- no Worker source changes;
- no Payload core changes;
- no D1 migration or schema changes;
- no topology change;
- no rerun of the passed remote E2E;
- no reinterpretation of prior failed harness runs as PASS.

## Inheritance boundary

The remote run tested application source `7104cc3d4e29ef62f1ae59d9ed5fcca770a12f0e`. Subsequent main changes in this admission batch are governance/evidence-only; the admitted runtime scope is therefore inherited unchanged under the Mapping 0 evidence inheritance rule.

## Decision

Admit the three evidence records above into the canonical Evidence Registry and remove only the now-closed remote HTTP/E2E, protected-account enumeration, and remote session-lifecycle blockers from AUTH-004's canonical Mapping record. Preserve the feature as `PARTIAL` / `NOT_GREEN`.
