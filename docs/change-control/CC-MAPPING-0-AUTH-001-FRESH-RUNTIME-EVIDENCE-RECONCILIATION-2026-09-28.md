# CC-MAPPING-0-AUTH-001-FRESH-RUNTIME-EVIDENCE-RECONCILIATION-2026-09-28

## Status

`PASS_VERIFIED / DEV_RUNTIME_EVIDENCE_REFRESHED / PRODUCTION_DEPLOYMENT_SEPARATE`

## Reason

PR #150 separated the DEVELOPMENT and PRODUCTION PRIV-004 policy artifacts. The existing AUTH-001 local evidence harness intentionally asserts the development policy version, so a fresh controlled run was required rather than inheriting the older runtime evidence without revalidation.

## Fresh evidence

- Tested implementation source: `dd803fb465bf91e9bd8e22ecd34798cdaec42359`
- Workflow: `.github/workflows/auth-001-registration-local-evidence.yml`
- Run: `36386908500`
- Artifact: `10954444469`
- Artifact SHA-256: `c7bfc953c93abc83ec66d4bc289f8c2970a1dc536d38282fa3a30b4818d6fe39`
- Environment: controlled local W01 OpenNext Worker + Wrangler local D1
- Development policy: `DEV-2026-09-28.1`
- Production policy artifact: `artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json`

## Result

The controlled runtime completed successfully and revalidated the existing AUTH-001 assertions:

- Payload-native User validation and hash/salt capture;
- no plaintext password persistence;
- one User + one Consent registration batch;
- canonical response digest and completed replay;
- same-key reuse conflict;
- forced later-statement rollback;
- concurrent duplicate identity single winner;
- canonical same-key replay/in-progress behavior;
- no W02/D1-01 mutation from the registration probe.

## Boundary

This is development/integration evidence only. It does not constitute a production deployment or production runtime verification.

PRIV-004 production engineering authority is separately admitted as `PROD-2026-09-28.1`; production deployment and production runtime evidence remain separate gates.

## Inheritance basis

After PR #150, the squash merge to `main` produced commit `5a3adce7e74547efb33225be8d2a8fdb0e72f63d`. The merge preserves the PR tree; no additional W01 registration source changes were introduced after the tested PR head. The fresh evidence therefore remains valid for the current development runtime scope under the normal evidence inheritance rule.
