# CC-AUTH-007-MFA-RUNTIME-EVIDENCE-INHERITANCE-2026-10-25

## Status

`SCOPED_EVIDENCE_ADMITTED / AUTH-007_NOT_GREEN`

## Purpose and boundary

Admit only two existing, executable evidence records under the repository's `INHERITED_UNCHANGED_SCOPE` policy:
- `EVD-AUTH007-MFA-LIVE-SECURITY-E2E-20261025-001`
- `EVD-AUTH007-W01-W02-PRODUCTION-RUNTIME-20261025-001`

This is an evidence/governance-only change. It does not change runtime code, public APIs, Worker ownership, Service Bindings, D1 schema, queues, production deployment, role assignments, or privileged authorization.

## Authoritative evidence

### Deployed W01/W02 binding

- Deployment workflow: [W01 W02 Auth Binding Deploy](https://github.com/wanghuinet/luckread/actions/runs/40154014151)
- Artifact: [deployment and runtime evidence](https://github.com/wanghuinet/luckread/actions/runs/40154014151/artifacts/12584315720)
- Exact deployment source SHA: `d58faf8ae7994bd9d6f04818ec15eab13a45427f`
- W02 Worker version: `07c1f043-49dd-44fc-a5d3-cbc942094d63`
- W01 Worker version: `a405d338-62b2-47c3-a547-28f1c16386e7`
- W01 `W02_AUTH` Service Binding targets `luckread-w02`
- Companion app auth/session E2E passed 12/12 assertions.

### Live MFA security E2E

- Workflow: [AUTH-007 MFA Live Security E2E](https://github.com/wanghuinet/luckread/actions/runs/40157067122)
- Sanitized artifact: [25/25 assertions](https://github.com/wanghuinet/luckread/actions/runs/40157067122/artifacts/12585720278)
- Exact harness/source SHA: `afae8f8947a4b2b7aa3358c5f359eb7577ba7b31`
- Job: `121060602451`
- Result: 25/25 passed, zero failed; the artifact omits credentials, TOTP/recovery secrets, cookies, session tokens, user IDs and response bodies.

The executed scope includes safe status projection, enrollment and authoritative read-back, invalid-code rejection without mutation, password-login challenge, valid TOTP, consumed-challenge rejection, same-step TOTP replay rejection, one-time recovery-code consumption and reuse rejection, disable with password plus fresh TOTP, session revocation, and post-disable read-back/login.

## Unchanged-scope evidence

The main baseline before this admission is `064d37261946f84d5cf2cd727f1a22572c15f6fe`.

GitHub's exact commit comparison from the deployment source `d58faf8ae7994bd9d6f04818ec15eab13a45427f` to that baseline reports changes only in:
- MFA test workflow and helper/test harness files;
- the W02 role-assignment verification workflow;
- AUTH-007 reconciliation/field-contract/entity-evidence metadata;
- the canonical Evidence Registry.

It reports no changed `workers/W01-payload/**` or `workers/W02-identity/src/**` production runtime source paths after the tested deployment. The comparison from the live MFA E2E source `afae8f8947a4b2b7aa3358c5f359eb7577ba7b31` to the same baseline contains only the AUTH-007 reconciliation document, factor-field contract, entity-implementation evidence, and Evidence Registry. No production runtime behavior changed in those post-test governance deltas.

Therefore the two records may use `freshnessMode=INHERITED_UNCHANGED_SCOPE` and point `inheritanceRef` to this document. The original execution SHA and source/artifact references remain unchanged; no historical evidence is rewritten to imply a new test execution.

## Evidence records admitted

1. `EVD-AUTH007-MFA-LIVE-SECURITY-E2E-20261025-001` — verified only for the enumerated 25/25 live E2E scenarios.
2. `EVD-AUTH007-W01-W02-PRODUCTION-RUNTIME-20261025-001` — verified only for the recorded W01/W02 deployment versions, Service Binding, and unchanged runtime source scope.

## Explicitly not admitted by this change

- `EVD-AUTH007-MFA-D1-01-SCHEMA-READBACK-20261025-001`: remains `PASS / CREATED`. Its historical artifact contains literal `$SOURCE_SHA` and `$DATABASE_NAME` because of the old single-quoted heredoc. A fresh protected controlled migration/read-back run using the corrected workflow is still required before formal admission.
- MFA challenge-expiry behavior.
- Cross-account authorization negative tests.
- Concurrent TOTP replay race, bounded attempt/rate-limit/lockout thresholds, and abuse negatives.
- Recovery-code rotation coverage.
- Production W02 publication journal → existing `AUTH013_QUEUE` → W06 immutable `AuditEvent` persistence, duplicate delivery, retry, DLQ and failure behavior.
- Canonical `ENT-MFA-FACTOR` entity/field admission, global Evidence Registry GREEN, final Mapping 0 / Five-Way acceptance, or complete AUTH-007 closure.

## Security decision

`AUTH-007 = BLOCKED_NOT_GREEN`.
Implementation authorization remains false.
No L8 genesis grant is authorized.
No production migration, role grant, Worker/D1/Queue creation, or runtime change is performed by this evidence admission.
