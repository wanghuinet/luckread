# CC-MAPPING-0-AUTH-001-RUNTIME-EVIDENCE-ADMISSION-2026-09-28

## Status

`RUNTIME_EVIDENCE_PASS_VERIFIED / PRODUCTION_BLOCKED`

## Scope

Admit the final controlled development runtime evidence for the merged AUTH-001 W01 registration implementation.

## Exact evidence

- Final tested source SHA: `b357ebe74f480f00c72f8fb0606226348570c105`
- GitHub Actions run: `36372326548`
- Job: `108771054689`
- Artifact: `10950235069`
- Environment: controlled local W01 OpenNext Worker + Wrangler local D1
- Development policy: `DEV-2026-09-28.1`
- Production deployment: **false**

## Verified assertions

The same-SHA evidence passed:

1. Payload-native registration validation generated native password hash/salt.
2. No plaintext password was persisted.
3. User + ENT-CONSENT + AUTH-001 registration envelope committed through the admitted single W01 D1 batch boundary.
4. `users.account_state=PENDING_VERIFICATION` and `account_state_version=1` were obtained from the already-admitted D1 schema defaults; W01 did not add a second lifecycle writer.
5. `response_digest` matched the admitted pre-commit replay commitment.
6. Completed replay returned HTTP 201 with the original committed response.
7. Reuse of the same idempotency key with changed input returned the canonical 422 conflict.
8. A forced failure of a later batch statement rolled back the earlier User/Consent writes.
9. Duplicate identity concurrency left exactly one authoritative User and one Consent.
10. Same-key concurrency satisfied the canonical idempotency contract: either one 409 `IDEMPOTENCY_IN_PROGRESS` while the other request commits, or both requests return the identical completed 201 replay; no duplicate registration was created.
11. No W02/D1-01 downstream mutation occurred from the registration probe.

## Governance result

Closed for the development implementation gate:

- AUTH-001 registration runtime implementation: **MERGED**
- Same-SHA controlled runtime evidence: **PASS_VERIFIED**
- Evidence Registry records: **ADMITTED as VERIFIED evidence**
- Mapping 0: **NOT_GREEN**
- Production deployment: **BLOCKED**
- Production privacy/legal authority: **BLOCKED pending real PRIV-004 authority**

This control does not authorize a production rollout and does not promote ENT-IDENTITY/ENT-CREDENTIAL or the overall Evidence Registry to GREEN.

## Provenance

- Implementation merge: `ca3986f8ecbdf866d4ebc7b57b8c3dce880a22d7`
- Final diagnostic cleanup merge: `75d30eeeeedf09ee6a9d08de2a2345cf85edee26`
- Exact runtime-tested source: `b357ebe74f480f00c72f8fb0606226348570c105`
- Runtime workflow: `.github/workflows/auth-001-registration-local-evidence.yml`


## Current-head environment-policy evidence reconciliation — 2026-09-28

The development runtime evidence was rerun because the AUTH-001 policy configuration boundary changed from a single shared artifact to explicit DEV/PROD policy artifacts.

Fresh controlled evidence:
- exact tested source SHA: `dd803fb465bf91e9bd8e22ecd34798cdaec42359`
- GitHub Actions run: `36386908500`
- artifact: `10954444469`
- artifact SHA-256: `c7bfc953c93abc83ec66d4bc289f8c2970a1dc536d38282fa3a30b4818d6fe39`
- development policy version exercised: `DEV-2026-09-28.1`
- production policy artifact exists separately at `artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json`
- production deployment: **false**

The fresh run passed the same AUTH-001 registration assertions as the previously admitted development evidence while proving the environment-separated policy resolution does not break the controlled development path.

This evidence does not authorize production deployment. Production policy authority is now separately admitted by PRIV-004; production deployment remains a separate deployment/evidence gate.
