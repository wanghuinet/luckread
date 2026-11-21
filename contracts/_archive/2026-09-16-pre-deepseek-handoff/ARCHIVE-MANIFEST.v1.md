# Luckread Contract Archive — Pre-DeepSeek Handoff

Archive date: 2026-09-16
Repository: `wanghuinet/luckread`
Branch: `main`
Immutable source snapshot commit: `b918f491f40f333c0356bd47c6406950f9c6a442`

## Purpose

This directory is a handoff safety anchor for the Contract-First authentication foundation before any external agent continues work.

The snapshot is the exact `main` commit above. The files listed below are the canonical contract artifacts reviewed immediately before handoff. Their blob SHA values are recorded so accidental or incorrect changes can be detected and reverted.

**Important:** current source-of-truth contract files are intentionally NOT deleted or moved. The archive is additive and fail-safe. The Git commit itself is the authoritative backup because every original file remains recoverable at the snapshot commit.

## Canonical snapshot files

| Area | Path | Blob SHA | Status at snapshot |
|---|---|---|---|
| Entity fields | `contracts/entity/entity-field-contract.v1.json` | `ea1831aa345061c683584b1be4311d6782865963` | NOT_GREEN |
| AUTH-002 | `contracts/entity/AUTH-002-session-field-contract.v1.json` | `685ff6e004c19d24b8a0d517d6b117d37b0eb3b6` | CONTRACTED_NOT_VERIFIED |
| AUTH-003 | `contracts/entity/AUTH-003-credential-field-contract.v1.json` | `e35b8fb796b2343514420b77c6629fb00e4fda44` | CONTRACTED_NOT_VERIFIED |
| AUTH-004 | `contracts/entity/AUTH-004-password-recovery-field-contract.v1.json` | `4c736cc6998d5d3a0807e7c848da3631813178be` | CONTRACTED_NOT_VERIFIED |
| AUTH-005 | `contracts/entity/AUTH-005-verification-field-contract.v1.json` | `aa3f4f1cd4fa16177b8357992dd44b79e2895f1b` | CONTRACTED_NOT_VERIFIED |
| AUTH-006 | `contracts/entity/AUTH-006-passkey-field-contract.v1.json` | `6312577ce54adf67843588296f82fc26bc247894` | CONTRACTED_NOT_VERIFIED |
| Canonical field authority | `contracts/entity/AUTH-002-006-canonical-field-authority.v1.json` | `a63b72ab58eb985927069717d890328d1fbed444` | CONTRACTED_NOT_VERIFIED |
| API/Entity/Field mapping | `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json` | `31f9949983ee16cfe1a2d0ccd5b34cd9d1d71c04` | CONTRACTED_NOT_VERIFIED |
| D1 schema mapping | `contracts/alignment/mapping-batches/AUTH-002-006-d1-schema-mapping.v1.json` | `cbdc5b4a89b39202205509b1010cf8641bc0a8db` | CONTRACTED_NOT_VERIFIED |
| Shared closure | `contracts/alignment/mapping-batches/AUTH-002-006-shared-closure-matrix.v1.md` | `ab06947a0528e0357f3bca5551cc13642fa9dbf6` | NOT_GREEN |
| Persistence closure | `contracts/persistence/AUTH-002-006-persistence-closure-contract.v1.md` | `602f3b13846608bcc507433f5a47ebf857f3ec92` | CONTRACTED_NOT_VERIFIED |
| Evidence contract | `contracts/evidence/AUTH-002-006-persistence-evidence-contract.v1.json` | `21bf818b7ec40bb587cf15cca41a25686987e880` | CONTRACTED_NOT_VERIFIED |
| Migration manifest | `contracts/migration/AUTH-002-006-migration-manifest.v1.json` | `15d2150fc75bcb33394b0630f1f7be53e64ad978` | CONTRACTED_NOT_VERIFIED |
| DTO registry | `contracts/dto/auth-dto-records.v1.json` | `4d6cb111eead6b5d616747b6b96c0d8a41944d03` | DEFINITION_PENDING_VERIFICATION |

## Recovery rule

If a later agent changes the canonical contracts incorrectly, compare the current tree against commit `b918f491f40f333c0356bd47c6406950f9c6a442` and restore only after reviewing the diff.

Do NOT restore blindly over legitimate later evidence. The snapshot is a rollback point, not permission to erase valid new work.

## Handoff invariants

- Luckread remains independent of D1-Fabric.
- Contract-First remains mandatory.
- `DEFINED != MAPPED != IMPLEMENTED != VERIFIED != GREEN`.
- Documentation cannot substitute for executable evidence.
- Real D1 schema/migration/runtime evidence is still pending for AUTH-002..006.
- Mapping 0 remains fail-closed.
- No AUTH-002..006 feature is GREEN at this snapshot.
