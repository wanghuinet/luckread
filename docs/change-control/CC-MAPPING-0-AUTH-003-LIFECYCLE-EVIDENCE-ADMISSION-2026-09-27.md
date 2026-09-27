# Change Control: AUTH-003 Lifecycle Runtime Evidence Admission — 2026-09-27

- Main tested source for lifecycle runtime: `c96b39569c7505ade615b15e63d87f5afb8066cc`.
- Backup branch: `backup/pre-auth003-lifecycle-evidence-admission-20260927`.
- Scope: admit already-executed controlled remote runtime evidence for AUTH-003 List and Replace/Remove lifecycle operations.
- No migration, schema mutation, production Worker deployment, new D1, queue, cache, or transport is introduced by this admission.

## Credential List evidence

Workflow: `.github/workflows/w02-auth-003-credential-list-runtime-evidence.yml`

- Run: `36307891924`
- Tested source SHA: `8a649ff602daaa0d4143324a52bcfa6c7443af6c`
- Target: `luckread` / D1-01 UUID `2f80471e-3756-49f9-8db1-7707a433ad64`
- Artifact: `10927373190`
- Artifact SHA256: `3be328033f2bb13474c1beddf8c85d2f5e496028afd0bb3875fbb552bad7850`
- Production Worker deployed: `false`
- Synthetic identity rows cleaned: `true`

The probe returned PASS and verified canonical public projection, deterministic createdAt/credentialId ordering, correct cursor continuation with terminal `hasMore=false`, self-scope isolation, endpoint-bound/malformed cursor rejection, max-limit enforcement, request-trace propagation, and cleanup.

## Replace/Remove lifecycle evidence

Workflow: `.github/workflows/w02-auth-003-credential-lifecycle-runtime-evidence.yml`

- Run: `36308120758`
- Runtime job: `108588706303`
- Tested source SHA: `c96b39569c7505ade615b15e63d87f5afb8066cc`
- Target: `luckread` / D1-01 UUID `2f80471e-3756-49f9-8db1-7707a433ad64`
- Artifact: `10928266844`
- Artifact SHA256: `a31d07cdf6ad9008e36faf410980e06f136aefc6e929aa18ba51ce50851ea56a`
- Production Worker deployed: `false`
- Synthetic rows cleaned: `true`

The probe returned PASS and verified cross-account Replace/Remove denial, public projection safety, normalized-value persistence, generic uniqueness conflict, idempotent Replace replay, Remove 204/no-body semantics, inactive persistence, harmless Remove replay, atomic concurrent Remove one-winner behavior, only-active removal protection, and protected-material exclusion.

## Canonical evidence records admitted

- `EVD-AUTH003-B19-LIST-RUNTIME-REMOTE-001`
- `EVD-AUTH003-B20-LIFECYCLE-RUNTIME-REMOTE-001`
- `EVD-AUTH003-B21-LIFECYCLE-SECURITY-REMOTE-001`
- `EVD-AUTH003-B22-LIFECYCLE-CONCURRENCY-REMOTE-001`

All four are `VERIFIED` and bound to their exact tested source SHAs. The List evidence remains valid under unchanged-scope inheritance because subsequent main changes in this batch are documentation/evidence admission only and do not modify the List implementation or runtime workflow.

## Disposition

AUTH-003 runtime coverage is now complete for List/Add/Replace/Remove under the admitted controlled runtime evidence set. This admission does **not** promote ENT-IDENTITY or ENT-CREDENTIAL, does **not** mark AUTH-003 or Mapping 0 GREEN, and does not reopen wire/API/DTO authority.

The remaining gate is final entity field/ownership reconciliation and Mapping 0 / Five-Way admission. No remote runtime rerun is required by this evidence-admission change alone.
