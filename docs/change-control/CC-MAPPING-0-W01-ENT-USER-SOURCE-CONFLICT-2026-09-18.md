# CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18

## Status

DECIDED — RECONCILIATION PENDING

## Purpose

Record the verified semantic conflict between the active W01 Payload Users collection source and the existing canonical ENT-USER contract evidence. This record is governance/control evidence only; it does not authorize implementation.

## Verified facts

1. The active runtime authority is `workers/W01-payload/`.
2. Current W01 `workers/W01-payload/src/collections/Users.ts` declares:
   - `slug: users`
   - `auth: true`
   - `fields: []`
   - `versions: false`
3. The legacy root `src/collections/Users.ts` contains the six previously documented profile/preference fields:
   - `username`
   - `displayName`
   - `bio`
   - `avatar`
   - `locale`
   - `timezone`
4. `contracts/entity/entity-field-contract.v1.json` currently treats those six ENT-USER fields as VERIFIED contract fields and points their source references at the legacy root scaffold.
5. `contracts/entity/entity-catalog.v1.json` currently marks ENT-USER as VERIFIED and points its implementation reference at the declared W01 runtime authority; the six field source references remain a separate unresolved contract-source issue.
6. `contracts/payload/payload-native-inventory.v1.json` has already been regenerated from W01 and therefore correctly observes zero W01 User business fields.
7. The existing W01 migration contains the Payload-native Users schema generated from the W01 collection state; source presence is not evidence that the six canonical business fields are implemented in W01.

## Conflict

The canonical ENT-USER field contract and the active W01 implementation source currently describe different field sets.

This cannot be resolved by:
- copying the six legacy fields into W01 without Change Control;
- changing the canonical field contract to zero fields merely to match W01;
- changing status to GREEN based on documentation;
- treating the legacy root scaffold as the W01 runtime implementation;
- inferring that generated migration columns prove current contract field implementation.

## Required decision

One explicit Change Control decision must choose the authoritative direction:

A. Promote the six canonical ENT-USER fields into W01 implementation and regenerate/review migration evidence; or

B. Reconcile and formally change the ENT-USER field contract/blueprint to match the intended W01 contract state.

Either choice requires:
- contract/blueprint reconciliation;
- deterministic evidence regeneration;
- persistence reconciliation;
- Mapping 0 re-validation.

No implementation is authorized by this record.

## Gate impact

- ENT-USER entity status: remains as currently contracted.
- ENT-USER persistence status: remains NOT_VERIFIED.
- Mapping 0: remains NOT_GREEN.
- W01 Payload inventory: remains the authoritative observed source for W01.
- Legacy root source: remains historical/non-authoritative for W01.

## Acceptance

This GAP is correctly recorded when the above conflict remains visible and no unsupported status promotion is made.

## Source-existence refinement — 2026-09-19

A direct repository probe found that the current W01 Users source exists at `workers/W01-payload/src/collections/Users.ts` and declares `fields: []`. The legacy path `src/collections/Users.ts` could not be resolved on the current tested commit, nor on the previously recorded queue-head `0dcba65c5475f99ee2d6692259488194813d14a3`.

This means the six ENT-USER field contract records currently reference a historical/nonexistent repository-relative path from the perspective of the inspected commits. Existing historical documents describing that path are not treated as current implementation evidence.

Evidence: `artifacts/mapping-0/w01-ent-user-source-existence-audit-2026-09-19.json`.

The authority decision remains unchanged: do not copy fields into W01 or rewrite the field contract until the existing Change Control decision selects the canonical direction.

## Archive-location correction — 2026-09-19

Follow-up repository-tree inspection corrected the earlier path-existence wording: the legacy Users collection is preserved at `archive/legacy-payload-root/src/collections/Users.ts`, not at the old repository-root path `src/collections/Users.ts`. Its six fields were directly verified in the archive.

`archive/legacy-payload-root/README.md` explicitly identifies the archive as historical reference material and names `workers/W01-payload/` as the active Payload runtime authority.

Therefore the substantive conflict is unchanged: the six canonical ENT-USER fields exist in the archived legacy source but are absent from active W01 Users discovery. The archive must not be treated as current implementation evidence.

## Decision accepted — 2026-09-20

Decision 7 accepted: the six existing canonical ENT-USER fields remain the target W01 Users contract; implementation remains behind GREEN→implement.
