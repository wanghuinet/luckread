# B14 — API → DTO → Entity Reconciliation Gate v1.0

## Status

`BLOCKED / EVIDENCE-BOUND`

This batch defines the closure gate for API → DTO → Entity mapping. It does **not** mark any feature GREEN and does not invent DTO IDs, Entity IDs, Field IDs, Payload collections, handlers, or tests.

## Authoritative inputs

1. `contracts/api/api-inventory.v1.json`
2. `contracts/openapi/v1/openapi.yaml`
3. `contracts/entity/entity-catalog.v1.json`
4. `contracts/entity/entity-field-contract.v1.json`
5. `contracts/alignment/cross-system-mapping.v1.json`
6. `contracts/alignment/database-entity-persistence-inventory.v1.json`
7. `contracts/alignment/payload-inventory.v1.json`
8. `contracts/alignment/code-evidence-inventory.v1.json`

The public API contract explicitly requires schema, OpenAPI, permission, scope, state-machine where applicable, persistence/mapping and integration evidence before an endpoint can become Contract Green. `contracts/api/api-inventory.v1.json` is the machine-readable public API baseline and treats Payload as an implementation dependency behind the domain/service boundary.

## Current verified facts

- The canonical cross-system mapping remains `NOT_GREEN`.
- Current mapping records contain API operation IDs for only a subset of AUTH features and do not yet bind DTO/entity/field/persistence/Payload/code/test evidence completely.
- USER, AUTHZ and ORG mapping records remain unresolved in the canonical registry.
- The API inventory contains the public endpoint groups for authentication, users/accounts, content, media, feed, interaction, notification, discovery, creator/IP/MCN, subscriptions/entitlements/payments, audit/compliance, analytics, recommendation/realtime and open-platform domains.
- The API inventory requires an explicit `mapping_ref`; an endpoint is not GREEN merely because a route exists in OpenAPI.

## Non-negotiable rules

1. Do not infer a DTO from an endpoint name.
2. Do not infer an Entity from a URL resource name.
3. Do not infer fields from request/response examples.
4. Do not promote a Payload collection to a canonical Entity without entity-catalog authority.
5. Do not use Payload Admin API behavior as public API evidence.
6. Do not assign a new API/DTO/Entity/Field ID in this batch merely to make a row complete.
7. `UNRESOLVED`, `MISSING`, `CONFLICT`, `DUPLICATE`, `DRIFT`, `EXTRA`, and `BLOCKED` remain blocking states.
8. Every GREEN mapping must be reversible: a reviewer must be able to traverse API → DTO → Entity → Field/Persistence → Payload → Code → Security → Lifecycle → Test/Evidence.
9. If an API has no authoritative DTO contract, it remains unresolved even if OpenAPI describes its shape.
10. If an Entity has no authoritative field/persistence contract, the API mapping cannot become GREEN.

## Required reconciliation record

For each public API operation, the eventual canonical record must establish:

- API operation ID / method / path
- API domain
- request DTO ID, when request body/query/path DTO is contract-owned
- response DTO ID, when response DTO is contract-owned
- Entity ID(s) touched
- Field ID(s) touched, including read/write classification
- persistence authority and storage mapping
- Payload collection/origin, if Payload-backed
- code/handler evidence
- security/permission/scope evidence
- lifecycle/state-machine evidence when stateful
- event/audit evidence when required
- test/e2e evidence
- evidence commit/reference

No field may be silently omitted because it is implemented by Payload natively. Native fields must still be classified as native versus contract-owned and have explicit authority evidence.

## Closure sequence

### B14.1 API baseline reconciliation

Cross-check every public endpoint group in `contracts/api/api-inventory.v1.json` against `contracts/openapi/v1/openapi.yaml`.

Required outcomes:

- exact operation/path correspondence
- no undocumented public operation promoted from implementation
- no inventory operation silently absent from OpenAPI
- every operation has a stable operation identity

### B14.2 DTO authority reconciliation

For every operation that has request/response data:

- locate the authoritative DTO/schema contract
- bind request and response shapes separately
- distinguish DTO from Payload document/internal schema
- record missing DTO authority as BLOCKED rather than creating one implicitly

### B14.3 Entity reconciliation

For every DTO field that represents durable domain state:

- bind to an authoritative Entity ID
- bind to canonical Field IDs
- distinguish transient transport fields from persisted fields
- identify relationship fields explicitly
- reject duplicate or conflicting entity ownership

### B14.4 Persistence/Payload boundary

For every persisted Entity field:

- bind to the persistence inventory
- bind to the Payload origin only when evidence exists
- distinguish Payload-native fields from contract-owned extension fields
- require migration/table/column evidence before persistence becomes GREEN

This step is intentionally dependent on the B13 persistence gate.

### B14.5 Security/lifecycle reconciliation

An API mapping cannot become GREEN until its permission/scope and state-machine requirements are bound. Sensitive and privileged operations additionally require security E2E evidence according to the API inventory.

### B14.6 Test/evidence reconciliation

A mapping is not GREEN from static documentation alone. The final evidence chain must include the applicable contract validator and integration/E2E evidence.

## Initial domain order

The work should be performed in this order to minimize cross-domain ambiguity:

1. `auth_identity`
2. `users_accounts`
3. `creator_ip_mcn`
4. `subscription_entitlement_payment`
5. `content`
6. `media`
7. `interaction`
8. `feed`
9. `notification`
10. `search_discovery`
11. `audit_compliance`
12. `analytics`
13. `recommendation_realtime`
14. `open_platform`

This is execution order only, not a quality ranking.

## Current blockers

- Canonical API → DTO registry is not yet evidence-complete.
- Canonical Entity/Field registry is not fully GREEN.
- Persistence evidence remains blocking for canonical entities.
- Security/lifecycle/test/evidence bindings are incomplete.
- Canonical `cross-system-mapping.v1.json` must remain `NOT_GREEN` until the complete chain is proven.

## Admission gate

B14 may be considered GREEN only when all applicable API operations in the selected closure slice have authoritative API, DTO, Entity, Field/Persistence, Payload, Security, Lifecycle, Test and Evidence bindings, and the canonical validators pass without unresolved records.

Until then, this document is a closure plan/evidence ledger, not implementation admission.
