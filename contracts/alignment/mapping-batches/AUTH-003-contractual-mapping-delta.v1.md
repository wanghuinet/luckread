# AUTH-003 Contractual Mapping Delta v1.1

## Status

`CONTRACTED_PARTIAL / NOT_GREEN`

## Current authority

AUTH-003 canonical operations are:

- `authCredentialList`
- `authCredentialAdd`
- `authCredentialReplace`
- `authCredentialRemove`

Canonical entities:

- `ENT-IDENTITY` — governing identity-side authority, still PROPOSED.
- `ENT-CREDENTIAL` — governing credential authority, still PROPOSED at catalog level pending final shared-entity promotion.

## Persistence mapping

The admitted physical persistence mapping is:

- `ENT-IDENTITY -> auth_identities`
- `ENT-CREDENTIAL -> auth_credentials`

All frozen credential fields are reconciled to concrete physical columns without inference. The authoritative credential uniqueness boundary is `(kind, normalized_value)`.

Physical mapping evidence is now VERIFIED for the admitted AUTH-003 credential slice, using:

- migration run `36296831559`
- exact-SHA schema postcheck run `36298629648`
- Add runtime run `36299334577`
- List runtime run `36307891924`
- Replace/Remove runtime run `36308120758`

## Entity disposition

### ENT-CREDENTIAL

Credential persistence/runtime implementation is evidenced for List/Add/Replace/Remove. Catalog promotion remains blocked because the entity points to `ENT-IDENTITY`, which has no independently evidenced production materialization/runtime ownership path.

### ENT-IDENTITY

The physical schema is evidenced, but seeded `auth_identities` rows used by controlled runtime harnesses are prerequisites, not production lifecycle implementation evidence. Catalog status therefore remains PROPOSED.

## Non-changes

- No API operationId change.
- No DTO change.
- No migration change.
- No D1 schema change.
- No Worker topology change.
- No Payload native auth/recovery change.
- No entity catalog promotion by dependency inference.
- No Mapping 0 GREEN.

## Next governed slice

Admit and implement the smallest ENT-IDENTITY materialization/runtime ownership slice against the already-established `auth_identities` persistence boundary, then produce exact-SHA evidence. Do not reopen AUTH-003 wire/API/DTO authority.

