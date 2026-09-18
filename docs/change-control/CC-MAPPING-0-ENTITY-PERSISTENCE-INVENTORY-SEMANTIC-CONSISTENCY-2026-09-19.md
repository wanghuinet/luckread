# Change Control — Entity Persistence Inventory Semantic Consistency

- ID: CC-MAPPING-0-ENTITY-PERSISTENCE-INVENTORY-SEMANTIC-CONSISTENCY-2026-09-19
- Date: 2026-09-19
- Scope: Entity/Persistence inventory schema and existing identity/auth records
- Status: APPROVED_FOR_GOVERNANCE_CORRECTION / NO NEW DOMAIN DESIGN

## Findings

The current Entity/Persistence inventory contains three established authentication-domain entities:

- `ENT-IDENTITY`
- `ENT-CREDENTIAL`
- `ENT-VERIFICATION`

The AUTH-002..006 persistence contract and shared persistence mapping assign these entities explicit persistence obligations in domain `D1-01`, with verification still required.

The inventory nevertheless records their `persistenceStatus` as `NOT_APPLICABLE`. This conflicts with the existing persistence obligation boundary. The appropriate state is `NOT_VERIFIED`: persistence is applicable/required, but execution and schema evidence have not been verified.

Separately, the inventory schema requires every record to contain a non-empty `implementationRef`, while the three proposed entities intentionally have no implementation reference and currently store an empty string. This is a schema-semantics conflict between the `PROPOSED` entity state and the generic required-field rule.

## Correction

1. Change `ENT-IDENTITY`, `ENT-CREDENTIAL`, and `ENT-VERIFICATION` persistenceStatus from `NOT_APPLICABLE` to `NOT_VERIFIED`.
2. Preserve their proposed entity status and empty implementation references; do not invent implementation paths.
3. Adjust the inventory schema so `implementationRef` may be empty for `PROPOSED` entities but must be non-empty for `VERIFIED` entities.
4. Do not create tables, migrations, APIs, DTOs, or runtime implementations as part of this correction.

## Non-goals

This change does not promote any entity to VERIFIED, does not alter physical D1 schema, and does not close AUTH-002..006 persistence verification.
