# Change Control — W01 ENT-USER Field Provenance Correction

- ID: CC-MAPPING-0-W01-ENT-USER-FIELD-PROVENANCE-2026-09-20
- Date: 2026-09-20
- Scope: ENT-USER field provenance metadata only
- Status: CLOSED — CORRECTIVE RECONCILIATION

## Basis

Existing authority decision `CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18` selected the active W01 `Users.ts` as the authoritative implementation source for the six canonical ENT-USER fields.

The current W01 source defines:
- `username`
- `displayName`
- `bio`
- `avatar`
- `locale`
- `timezone`

## Finding

`contracts/entity/entity-field-contract.v1.json` already referenced the active W01 source for all six fields, but each field incorrectly declared `payloadNative:false`. The same ENT-USER record also retained legacy root evidence references at the entity level.

Because the fields are defined directly in the active Payload `Users` collection, the provenance metadata was inconsistent with the selected W01 authority.

## Correction

On source head immediately before this record, the following metadata-only reconciliation was applied:
- six ENT-USER field records: `payloadNative:false` → `payloadNative:true`;
- entity-level ENT-USER evidence references: legacy `src/...` paths → active W01 `workers/W01-payload/...` paths.

No field name, type, requiredness, uniqueness, default, API exposure, migration state, Entity ID, or runtime behavior was changed.

## Verification basis

- Active W01 `Users.ts` was directly verified to contain the six fields.
- `contracts/payload/payload-native-inventory.v1.json` records the same six fields from W01.
- `contracts/alignment/payload-inventory.v1.json` was independently refreshed and verified against the W01 native inventory.
- The correction changes provenance metadata only and does not create implementation or persistence evidence.

## Acceptance

- Provenance reconciliation: `PASS_VERIFIED`.
- Runtime/persistence/migration evidence: unchanged and still gated.
- Mapping-0 status: unchanged.
- This control does not authorize migration execution or GREEN promotion.
