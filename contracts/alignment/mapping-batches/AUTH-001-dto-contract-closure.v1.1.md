# AUTH-001 DTO Contract Closure v1.1

Status: BLOCKED_UNTIL_CANONICAL_DTO_REGISTRY

## Evidence boundary
The repository currently verifies the `authRegister` operation and `ENT-USER`, but the canonical DTO registry/bindings are not yet verified. This record therefore does not promote AUTH-001 and does not create implementation evidence.

## Closure requirements
- Identify the existing canonical DTO registry, if present.
- Bind `authRegister` request/response schemas to stable DTO IDs from that registry.
- Preserve the OpenAPI schema as the field authority.
- Bind DTO fields to `ENT-USER` fields or explicitly documented derived-response rules.
- Verify credential secrecy and classification.
- Verify API version/compatibility semantics.
- Add Evidence Registry provenance including source path, commit SHA and validator result.

## Explicit prohibition
Do not use placeholder DTO IDs as canonical mapping IDs until the canonical DTO registry is verified. Do not implement runtime code while Mapping 0 remains non-GREEN.

## Current gate
`AUTH-001 = BLOCKED_NOT_GREEN`
