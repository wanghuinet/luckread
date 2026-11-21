# USER-002 / USER-003 Evidence-Bound Mapping Delta v1.0

- Status: `PARTIAL_NOT_GREEN`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
- Canonical mapping: `contracts/alignment/cross-system-mapping.v1.json`
- Evidence policy: fail-closed; no inference

## USER-002 — Avatar / Banner / Bio / Display Name

### Verified evidence
- Canonical feature: `USER-002` from the master Blueprint.
- Verified entity: `ENT-USER`.
- Verified Payload fields: `displayName`, `bio`, `avatar`.
- No verified canonical `banner` field was found in the inspected repository evidence.
- Existing operation evidence includes `getMe` / `updateMe`, but the feature-level API/DTO binding is not yet reconciled into the canonical USER-002 record.

### Remaining blockers
- Banner authority and field contract.
- Canonical API -> DTO -> Entity -> Field binding.
- Persistence/migration evidence.
- Cache invalidation evidence.
- Security/integration test evidence.
- Evidence Registry binding.

### Gate
`PARTIAL_NOT_GREEN` — do not promote to GREEN.

## USER-003 — Locale / Language / Timezone

### Verified evidence
- Canonical feature: `USER-003` from the master Blueprint.
- Verified entity: `ENT-USER`.
- Verified Payload fields: `locale`, `timezone`.
- Current documented defaults: `locale=en-US`, `timezone=UTC`.
- No authoritative canonical `language` field was found in the inspected evidence.

### Remaining blockers
- Canonical language-field authority.
- Profile/preference API and DTO binding.
- Persistence/migration evidence.
- Localization lifecycle mapping.
- Security/test evidence.
- Evidence Registry binding.

### Gate
`PARTIAL_NOT_GREEN` — do not promote to GREEN.

## Reconciliation rule

This delta records only repository-supported evidence. Existing fields are not treated as proof of complete feature closure. No API, DTO, Entity, Field, Security, Lifecycle, Code, or Test identifiers are invented. Canonical `cross-system-mapping.v1.json` remains the authority and must be updated only through evidence-bound reconciliation.
