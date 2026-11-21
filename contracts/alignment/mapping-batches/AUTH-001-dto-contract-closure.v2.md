# AUTH-001 DTO Contract Closure v1.1

Status: BLOCKED_UNTIL_OPENAPI_SCHEMA_VERIFICATION

## Verified facts
- Feature: `AUTH-001`.
- API operation: `authRegister` is already present in the repository's OpenAPI/API contract evidence.
- Current verified User entity candidate: `ENT-USER`.

## Proposed stable DTO identifiers
- `DTO-AUTH-REGISTER-REQUEST`
- `DTO-AUTH-REGISTER-RESPONSE`

These identifiers are contract placeholders until the canonical DTO registry and OpenAPI schema bindings are independently verified. They MUST NOT be treated as implementation evidence.

## Required evidence before promotion
1. OpenAPI request schema is the sole field authority for the request DTO.
2. OpenAPI response schema is the sole field authority for the response DTO.
3. DTO IDs are referenced by the canonical API/capability mapping.
4. Every DTO field maps to an explicit entity/field or derived response rule.
5. Nullability, requiredness, format, enum, length and security classification are preserved.
6. No credential secret is exposed by the response DTO.
7. DTO versioning and compatibility rules are explicit.
8. Evidence Registry contains source, commit SHA and validation result.

## Gate
`AUTH-001` remains `BLOCKED_NOT_GREEN` until all required evidence is executable and independently validated.
