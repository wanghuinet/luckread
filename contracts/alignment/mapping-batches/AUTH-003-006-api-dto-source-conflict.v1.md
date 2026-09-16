# AUTH-003–AUTH-006 API/DTO Source Conflict Gate v1.0

## Status

`BLOCKED_NOT_GREEN`

## Finding

The current mapping layer contains operation IDs and DTO IDs for AUTH-003 through AUTH-006, but the canonical DTO contract explicitly states that its bindings are authoritative only for operations actually present in the current OpenAPI contract. AUTH-003/004/005 are currently recorded as unresolved in that DTO contract.

At the same time, feature-specific API contracts and contractual mapping deltas define additional operations for AUTH-003 through AUTH-006.

Therefore the existing persistence mapping MUST NOT promote those operation/DTO references to canonical Mapping-0 bindings until the API authority chain is reconciled.

## Concrete conflict

### AUTH-003

Persistence mapping currently references legacy-style operation IDs such as:

- `authUsernameCreate`
- `authUsernameChange`
- `authEmailAdd`
- `authEmailChange`
- `authPhoneAdd`
- `authPhoneChange`

The feature-specific contractual mapping delta instead defines the canonical credential-management operations:

- `authCredentialList`
- `authCredentialAdd`
- `authCredentialReplace`
- `authCredentialRemove`

The DTO contract currently has no canonical AUTH-003 operation binding.

### AUTH-004

The feature-specific API contract defines:

- `authPasswordChange`
- `authPasswordResetRequest`
- `authPasswordResetConfirm`

The DTO layer must bind these through the authoritative API/OpenAPI chain before promotion.

### AUTH-005

The mapping layer references verification operations and DTO IDs, but canonical DTO binding must first be reconciled against the authoritative API/OpenAPI source.

### AUTH-006

The mapping layer references passkey operations and DTO IDs, but canonical DTO binding must first be reconciled against the authoritative API/OpenAPI source.

## Required resolution

One and only one authority chain must be selected and made internally consistent:

`Blueprint -> API contract/OpenAPI -> DTO registry -> Entity/Field authority -> Mapping`

If a feature-specific API contract is authoritative, its operations must be represented in the canonical API/OpenAPI source and then bound in the DTO contract. If OpenAPI remains authoritative, feature-specific operation IDs that are absent from OpenAPI must remain non-canonical and must not be mapped as verified.

## Prohibited shortcut

Do NOT rename Mapping rows merely to make them match another contract. Do NOT copy DTO IDs into the DTO registry without corresponding canonical operation/schema evidence. Do NOT mark AUTH-003–AUTH-006 GREEN based on contractual deltas alone.

## Closure criteria

- AUTH-003 canonical operations resolved;
- AUTH-004 canonical operations resolved;
- AUTH-005 canonical operations resolved;
- AUTH-006 canonical operations resolved;
- canonical DTO records exist for all promoted operations;
- mapping rows use the canonical operation/DTO IDs;
- Mapping-0 detects no stale operation or DTO references;
- runtime and persistence evidence remain separate downstream gates.

Until all criteria pass, status remains `BLOCKED_NOT_GREEN`.
