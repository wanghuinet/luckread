# CC-MAPPING-0-AUTH-003-ENTITY-FIELD-OWNERSHIP-RECONCILIATION-2026-09-27

## Status

`PASS_VERIFIED_PHYSICAL_MAPPING / BLOCKED_ENTITY_AUTHORITY`

## Scope

Reconcile the already-admitted AUTH-003 persistence/runtime evidence against the frozen ENT-IDENTITY and ENT-CREDENTIAL field contracts. This control changes no code, schema, migration, Worker topology, API/DTO authority or runtime behavior.

## Field-to-persistence reconciliation

### ENT-IDENTITY

The admitted migration and read-only D1 post-migration evidence establish the physical table and field names:

| Contract field | Physical column | Evidence disposition |
| --- | --- | --- |
| id | id | observed in migration/postcheck |
| userId | user_id | observed in migration/postcheck |
| username | username | observed in migration/postcheck |
| usernameNormalized | username_normalized | observed in migration/postcheck |
| email | email | observed in migration/postcheck |
| emailNormalized | email_normalized | observed in migration/postcheck |
| phone | phone | observed in migration/postcheck |
| phoneNormalized | phone_normalized | observed in migration/postcheck |
| normalizationVersion | normalization_version | observed in migration/postcheck |

Persistence constraints/indexes are also bound by the admitted migration and exact-SHA post-migration evidence.

**Authority disposition:** physical mapping is verified, but the canonical entity remains `PROPOSED`. No independent production identity materialization/CRUD lifecycle implementation is evidenced. AUTH-003 runtime probes use seeded `auth_identities` fixtures as a prerequisite dependency; they do not prove identity lifecycle ownership.

### ENT-CREDENTIAL

The nine canonical contract fields map directly to the admitted `auth_credentials` table:

| Contract field | Physical column | Evidence disposition |
| --- | --- | --- |
| id | id | schema + runtime |
| identityId | identity_id | schema + runtime |
| kind | kind | schema + runtime |
| valueHash | value_hash | schema + runtime |
| normalizedValue | normalized_value | schema + runtime |
| verifiedAt | verified_at | schema + runtime |
| active | active | schema + runtime |
| createdAt | created_at | schema + runtime |
| updatedAt | updated_at | schema + runtime |

The authoritative uniqueness boundary is `(kind, normalized_value)`. The separate `value_hash` uniqueness constraint remains admitted by the migration and schema evidence. `identity_id` is an explicit FK to `auth_identities(id)`.

Runtime evidence covers the admitted List/Add/Replace/Remove slice, including public projection safety, self-scope, normalization, uniqueness conflict semantics, idempotent replay, lifecycle state mutation and concurrent Remove one-winner behavior.

**Evidence sources:**

- migration: run `36296831559`
- exact-SHA D1 postcheck: run `36298629648`
- Add runtime: run `36299334577`
- List runtime: run `36307891924`
- Replace/Remove lifecycle runtime: run `36308120758`

## Entity promotion decision

- `ENT-CREDENTIAL`: implementation/persistence/runtime evidence is now complete for the admitted AUTH-003 credential slice, but catalog promotion remains blocked because its canonical identity target `ENT-IDENTITY` is still proposed and Mapping 0 / Five-Way is not GREEN.
- `ENT-IDENTITY`: remains `PROPOSED`; no production identity materialization/ownership implementation is promoted from seeded runtime fixtures.
- No feature/entity promotion is inferred across the shared AUTH-002 dependency boundary.

## Next executable gate

The next governed slice is **identity materialization/runtime ownership for ENT-IDENTITY**, using the already-admitted `auth_identities` schema as the persistence boundary. It must have an explicit change-control admission before implementation and must not reopen AUTH-003 wire/API/DTO authority.

Mapping 0 remains `NOT_GREEN`.
