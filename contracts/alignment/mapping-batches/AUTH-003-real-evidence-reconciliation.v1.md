# AUTH-003 Real Evidence Reconciliation v1.1

- Feature: `AUTH-003`
- Name: username/email/phone credentials
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`
- Source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

## 1. Closed authority chain

The canonical AUTH-003 API, DTO and entity references are now explicit:

- `authCredentialList`
- `authCredentialAdd`
- `authCredentialReplace`
- `authCredentialRemove`
- `ENT-IDENTITY`
- `ENT-CREDENTIAL`

The public credential projection remains exactly `credentialId`, `kind`, `active`. No protected credential material is admitted to public projection.

## 2. Persistence reconciliation

The controlled D1-01 target is `luckread`, UUID `2f80471e-3756-49f9-8db1-7707a433ad64`.

The admitted AUTH-003 migration and exact-SHA read-only postcheck reconcile:

- `ENT-IDENTITY -> auth_identities`
- `ENT-CREDENTIAL -> auth_credentials`

The field-to-column mappings and persistence constraints are recorded in:

- `contracts/alignment/mapping-batches/AUTH-002-006-d1-schema-mapping.v1.json`
- `docs/change-control/CC-MAPPING-0-AUTH-003-ENTITY-FIELD-OWNERSHIP-RECONCILIATION-2026-09-27.md`

No table or column names are inferred.

## 3. Runtime evidence disposition

The following controlled runtime evidence is admitted and VERIFIED:

- Add: run `36299334577`
- List: run `36307891924`
- Replace/Remove lifecycle: run `36308120758`

These runs establish the executable credential slice under exact tested source provenance. No production Worker deployment occurred in these evidence probes.

## 4. Entity disposition

### ENT-CREDENTIAL

Persistence and runtime evidence are complete for the admitted List/Add/Replace/Remove credential-management slice.

Current canonical disposition:

- catalog: `PROPOSED`
- implementation evidence: `IMPLEMENTED`
- persistence: `VERIFIED`
- overall promotion: `BLOCKED`

Reason: the credential entity has an explicit FK relationship to `ENT-IDENTITY`, while `ENT-IDENTITY` is still proposed. Entity promotion is fail-closed and cannot be inferred from dependency fixtures.

### ENT-IDENTITY

Physical schema/migration evidence is present, but there is no independently evidenced production identity materialization/CRUD lifecycle implementation.

Current canonical disposition:

- catalog: `PROPOSED`
- implementation evidence: `BLOCKED`
- persistence: `NOT_VERIFIED`
- overall promotion: `BLOCKED`

The AUTH-003 runtime probes seed `auth_identities` rows only as controlled prerequisites. Seeded fixtures are not treated as product identity lifecycle evidence.

## 5. Security and lifecycle

The admitted runtime evidence verifies self-scope, cross-account denial, public projection safety, generic credential conflicts, deterministic normalization/uniqueness handling, idempotent Replace replay, only-active credential removal protection and concurrent Remove one-winner behavior.

## 6. Remaining gate

The next governed implementation slice is **ENT-IDENTITY materialization/runtime ownership**.

That slice must receive explicit change-control admission and exact runtime evidence. AUTH-003 wire/API/DTO authority remains closed and must not be reopened.

Mapping 0 / Five-Way remains `NOT_GREEN`.
