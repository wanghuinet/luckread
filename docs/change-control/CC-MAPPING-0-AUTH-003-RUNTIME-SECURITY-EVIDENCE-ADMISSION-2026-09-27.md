# Change Control: AUTH-003 Remote Runtime/Security Evidence Admission — 2026-09-27

- Admission record originally created after runtime execution; provenance corrected below. Current main at correction sequence: `f1853d3ee29f6f0cf84e8991096be062ea56c98b`.
- Backup branch: `backup/pre-auth003-runtime-evidence-admission-20260927`.
- Scope: admit only the already-executed controlled remote AUTH-003 credential-add runtime/security evidence.
- No remote migration, schema mutation, production Worker deployment, or new transport is introduced.

## Runtime evidence

Workflow: `.github/workflows/w02-auth-003-credential-add-runtime-evidence.yml`

- Run: `36299334577`
- Runtime job: `108563979953`
- Tested source SHA: `5dff85d47578eb1dcaa57a53b0a072dfe2a80d88`
- Target: `luckread` / D1-01 UUID `2f80471e-3756-49f9-8db1-7707a433ad64`
- Artifact: `10924573167`
- Artifact SHA256: `5ee09ed921ec8d1c1805e2db20c73a54a6be6c37a6a0ca4ddb3bf29f7ce353b5`
- Production Worker deployed: `false`

The remote probe returned PASS. It verified cross-account denial, public-safe projection, idempotent replay, idempotency conflict, one-winner normalized-value concurrency, generic conflict for the loser, single normalized owner, and bounded synthetic cleanup.

## Admission disposition

Three canonical evidence records are admitted:

- `EVD-AUTH003-B16-RUNTIME-PERSISTENCE-REMOTE-001`
- `EVD-AUTH003-B17-SECURITY-NEGATIVE-REMOTE-001`
- `EVD-AUTH003-B18-CONCURRENCY-REMOTE-001`

Their status is `VERIFIED` and provenance is bound to the exact tested implementation SHA.

## Remaining gate

Runtime/security admission does **not** promote ENT-IDENTITY or ENT-CREDENTIAL and does **not** make Mapping 0 GREEN. The next gate is physical-field/ownership reconciliation against the frozen entity contract, followed by explicit decision material.

## Provenance correction

The runtime workflow run `36299334577` checked out and executed exact implementation source `419bb7fd887af0c30412bead50f8196ec6446bb7`. The later admission/main SHA must not be substituted for the tested source SHA.
