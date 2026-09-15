# Pre-Contract Step 4 — API / Payload Closure v1.0

Status: IN PROGRESS / NOT GREEN

## Authority

API is the exposure layer over canonical capabilities. Payload is an upstream CMS/application foundation and must remain unmodified. Payload origin for each capability must be explicit.

## Required five-way path

`Feature -> Capability -> API Operation -> DTO -> Entity/Data`

with an independent Payload mapping:

`Capability -> Payload origin -> Collection/Global/Access/Hook/Component/Plugin/Application boundary`

## Payload origin vocabulary

Every mapped capability must declare one of:

- `native`
- `native-extension`
- `luckread-extension`
- `composite`
- `application`
- `infrastructure`
- `external`
- `operational`

Payload Core itself is never a Luckread implementation boundary.

## API admission rules

1. Every operation has a stable API operation ID.
2. Every request and response field maps to a capability/data/behavior contract.
3. DTOs are exposure contracts and must not silently become persistence schemas.
4. Authorization, entitlement, moderation and playback checks are server-side invariants.
5. Internal APIs cannot bypass the same authorization boundary merely because they are internal.
6. API versioning and backward compatibility are explicit contract concerns.
7. Search/feed/recommendation/analytics endpoints cannot create alternative sources of truth.
8. High-frequency behavior must use the event/aggregation model where the platform contract requires it.

## Required reconciliation states

`MATCH`, `MAPPED`, `MISSING`, `EXTRA`, `DRIFT`, `CONFLICT`, `DUPLICATE`, `UNRESOLVED`, `BLOCKED`.

No `UNRESOLVED` or `CONFLICT` may be interpreted as GREEN.

## Current evidence

The repository already has an API Inventory Reconciliation Contract and machine-readable reconciliation schema. The frozen blueprint explicitly requires API Inventory Reconciliation followed by API/DTO/Entity reconciliation. Existing capability reconciliation records show that canonical API IDs and Entity/Field bindings are not complete across all domains. Step 4 therefore remains NOT GREEN.

## Exit criteria

Step 4 is GREEN only when every admitted capability has complete API operation/DTO/entity mapping, explicit authorization behavior, explicit Payload origin/boundary, and no unresolved or conflicting API/Payload ownership.
