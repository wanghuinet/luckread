# Mapping-0 AUTH Technical Closure Queue

Date: 2026-09-18
Repository: `wanghuinet/luckread`
Baseline reviewed head: `d98d5f796e9d51aa81768245f9c90f16a986a853`

## Purpose

This queue converts the current AUTH residual state into executable verification work without inventing new API, DTO, entity, persistence, security, or Worker design.

## AUTH-006 — Passkey/WebAuthn

### Existing authoritative artifacts

- API contract: `contracts/api/AUTH-006-passkey-webauthn-contract.v1.json`
- Field contract: `contracts/entity/AUTH-006-passkey-field-contract.v1.json`
- Shared API/Entity/Field mapping: `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`
- Persistence contract: `contracts/persistence/AUTH-002-006-persistence-closure-contract.v1.md`
- Migration gate/manifest: `contracts/migration/AUTH-002-006-migration-gate.v1.md`, `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
- Evidence contract: `contracts/evidence/AUTH-002-006-persistence-evidence-contract.v1.json`

### Current evidence state

The API contract is `CONTRACTED_NOT_VERIFIED`. Its evidence status records API/DTO/entity as `CONTRACTED_NOT_VERIFIED`, and persistence/runtime/security-E2E/Mapping-0 as missing.

The field contract is `CONTRACTED_NOT_VERIFIED`. Physical D1 table/column/index evidence is still pending actual schema evidence.

The shared persistence mapping currently carries AUTH-006 DTO aliases `DTO-AUTH-006-PASSKEY-REGISTRATION-OPTIONS`, `DTO-AUTH-006-PASSKEY-REGISTRATION-VERIFY`, `DTO-AUTH-006-PASSKEY-ASSERTION-OPTIONS`, `DTO-AUTH-006-PASSKEY-ASSERTION-VERIFY`, and `DTO-AUTH-006-PASSKEY-REMOVE`, while the feature API contract uses `DTO-AUTH-006-REGISTRATION-OPTIONS`, `DTO-AUTH-006-REGISTRATION-VERIFY`, `DTO-AUTH-006-ASSERTION-OPTIONS`, `DTO-AUTH-006-ASSERTION-VERIFY`, and `DTO-AUTH-006-REMOVE`. This remains an unresolved authority mismatch; no rename or promotion is permitted without explicit OpenAPI/DTO authority resolution. No executable implementation or security E2E evidence is admitted by the reconciliation record.

### Admissible next work

1. Verify the already-contracted operation/DTO/entity/field bindings against actual repository implementation.
2. Acquire the required real D1 schema and migration execution evidence on the tested commit.
3. Run required positive/negative passkey security tests already defined by the contract.
4. Bind all accepted evidence to the exact tested commit SHA.
5. Re-run Mapping-0 validation; only then consider status promotion.

No new operation, field, physical table name, persistence location, or security rule may be invented during this queue.

## AUTH-007 — MFA

### Existing authoritative artifacts

- Blueprint: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability reconciliation: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- MFA reconciliation: `contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md`
- API domain audit: `contracts/api/api-domain-audit.v1.json`
- Security and permission authorities: `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`, `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md`, `docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`

### Current closure blocker

The repository explicitly records no canonical MFA operation IDs, factor DTO set, factor entity/field contract, lifecycle contract, or executable MFA implementation.

### Admissible next work

Establish a canonical MFA contract only through explicit Contract/Change Control using the already identified authorities. Until that authority is approved and frozen, do not invent endpoint, DTO, factor type, storage field, recovery mechanism, or provider behavior.

## AUTH-008 — OAuth/social login

### Existing authoritative artifacts

- Blueprint: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Capability reconciliation: `contracts/capability/reconciliation-batches/B01-identity-auth-account.v1.json`
- Detailed reconciliation: `contracts/alignment/mapping-batches/AUTH-008-real-evidence-reconciliation.v1.md`
- Identity/session authority: `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- Authorization/security authorities: `docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`, `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md`, `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`

### Current closure blocker

The repository has generic OAuth/OIDC contract material and external identity lifecycle claims, but no canonical social-login API/DTO/entity/linking/persistence/runtime chain has been verified.

### Admissible next work

Freeze the social-login contract via Change Control, reusing the existing Identity/Auth boundary. Then perform mapping and runtime validation. Do not introduce a parallel identity system or infer provider-specific implementation.

## AUTH-009 — Linked identities

### Existing authoritative artifacts

- Blueprint and B01 capability record
- `contracts/alignment/mapping-batches/AUTH-009-reconciliation.v1.md`
- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`

### Current closure blocker

The reconciliation record explicitly states that canonical linked-identity entity/field contracts and link/unlink/list API/DTO bindings are not evidence-bound.

### Admissible next work

Freeze the canonical linked-identity API/entity/security contract through Change Control, then validate provider ownership, uniqueness, recovery impact, authorization, persistence and runtime evidence.

## AUTH-013..016

Remain PARTIAL. Existing B01 and per-feature reconciliation materials describe account-state, recovery, deletion/restoration, and verification requirements, but authoritative end-to-end API/DTO/entity/security bindings and executable evidence are incomplete.

## W01 runtime-source finding

The active W01 tree currently contains the migration source `workers/W01-payload/src/migrations/20250929_111647.ts` and `src/migrations/index.ts`, plus a committed `workers/W01-payload/pnpm-lock.yaml`. These facts reduce the earlier source-presence uncertainty but do not prove controlled remote-D1 execution, schema equivalence, or runtime security evidence.

## Global fail-closed rule

Documentation, reconciliation notes, historical artifacts, or generic contracts are not runtime evidence. A feature may be promoted only after authoritative contract binding, executable implementation where applicable, deterministic tests/validation, commit-bound evidence, and final Mapping-0 reconciliation.

## Current result

This queue does not change any canonical Mapping record or status. It identifies the shortest admissible path from the current fail-closed state to technical closure.
