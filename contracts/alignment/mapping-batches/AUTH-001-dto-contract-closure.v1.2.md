# AUTH-001 DTO Contract Closure v1.2

Status: BLOCKED_UNTIL_CANONICAL_DTO_REGISTRY

## Verified evidence
- `AUTH-001` exists in the capability/mapping inventory.
- `authRegister` exists as the API operation.
- `ENT-USER` is currently the verified User entity implementation candidate.
- No canonical DTO registry was found under `contracts/dto` by repository search.

## Decision
Do not invent or canonize DTO IDs in Mapping 0 from placeholders. The DTO layer is a blocking contract gap.

## Required next closure
Create/identify one canonical DTO registry with stable DTO IDs, schema references, field-level bindings, security classification and version semantics. Then update AUTH-001 mapping only from those verified IDs.

## Gate
`AUTH-001 = BLOCKED_NOT_GREEN`; implementation remains prohibited while Mapping 0 is non-GREEN.
