# AUTH-004 Wire Projection Decision Gate v1.0

- Feature: `AUTH-004`
- Scope: password change / password reset request / password reset confirm
- Status: `DECISION_GATE_CLOSED / BLOCKED_NOT_GREEN`
- Implementation authorization: `false`

## 1. Authority inspected

The following artifacts are authoritative inputs for this gate:

- `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- `contracts/entity/AUTH-004-password-recovery-field-contract.v1.json`
- `contracts/alignment/mapping-batches/AUTH-004-real-evidence-reconciliation.v1.md`
- `contracts/alignment/mapping-batches/AUTH-003-006-openapi-promotion-input.v1.md`
- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`

The API contract currently establishes three operations and their authorization boundaries, but does not establish complete request/response field schemas. fileciteturn13file0

## 2. Confirmed non-public material

The recovery field contract establishes the following persistence fields: recovery identifier, identity relation, purpose, token hash, issuance/expiry timestamps, consumed/invalidated timestamps, and password hash. These are persistence/security fields and are not authorized as public response fields by this gate. fileciteturn14file0

The following must remain non-public unless a later authoritative API decision explicitly overrides the classification:

- raw recovery token
- token hash
- password hash / password material
- internal identity/recovery identifiers when used only for persistence correlation
- consumed/invalidated persistence timestamps when they are not explicitly part of a public response contract

## 3. Missing wire decisions

No public request/response schema is promoted by this gate. The following decisions remain required before OpenAPI/DTO promotion:

### 3.1 `authPasswordChange`

Freeze:

1. exact request field names
2. field types and accepted formats
3. requiredness and nullability
4. current-password representation and validation semantics
5. new-password representation and password policy reference
6. whether a success response has a body or uses an empty response
7. exact success status
8. generic failure/error mapping without account or credential enumeration
9. explicit idempotency requirements, if applicable under the common mutation contract

### 3.2 `authPasswordResetRequest`

Freeze:

1. exact account/recovery identifier request field
2. accepted identifier formats
3. requiredness/nullability
4. enumeration-resistant success behavior
5. success status and response body/no-body semantics
6. retry/rate-limit contract reference, if already authoritative elsewhere
7. whether any recovery delivery metadata is public
8. error mapping that does not disclose account existence

### 3.3 `authPasswordResetConfirm`

Freeze:

1. exact recovery-token input field and representation
2. exact new-password input field and password policy reference
3. requiredness/nullability
4. success status and response body/no-body semantics
5. generic invalid/expired/replayed/wrong-purpose failure mapping
6. session/token invalidation response semantics, if any public projection exists
7. idempotency/replay behavior at the wire boundary

## 4. Security invariants already frozen

The canonical API contract requires single-use, time-bounded, purpose-bound recovery tokens; raw tokens must not be persisted or logged; passwords must not be returned or logged; successful password change/reset revokes affected sessions; and account enumeration resistance is required. fileciteturn13file0 fileciteturn14file0

These invariants are constraints on the eventual wire contract. They do not authorize inventing DTO fields.

### 4.1 Lifecycle authority inherited from the Identity & Session Instance Registry

The L5/L6 registry is an additional authoritative lifecycle input for AUTH-004. It explicitly establishes these execution-level claims:

- current-credential verification is rate-limited;
- password-reset requests create a durable operation/token boundary and must not reveal account existence;
- password-reset requests are rate-limited;
- reset tokens expire and are stored safely without logging the raw token;
- expired or wrong-use reset tokens are rejected;
- reset-token consumption is single-use and concurrent double-consumption is denied;
- password replacement invalidates the old credential and must keep secret material out of telemetry.

These claims freeze lifecycle/security behavior only. They do **not** authorize public field names, token wire representation, HTTP status codes, response bodies, error-code mappings, delivery metadata, or per-operation Idempotency-Key requirements. The latter remain explicit AUTH-004 wire/policy decisions.

## 5. Promotion gate

Until the missing wire decisions above are explicitly established by an authoritative API decision artifact:

- `NO_OPENAPI_WRITE`
- `NO_DTO_REGISTRY_PROMOTION`
- `NO_MAPPING_0_PROMOTION`
- `NO_RUNTIME_IMPLEMENTATION_AUTHORIZATION`
- `NO_GREEN`

The existing real-evidence reconciliation independently confirms that runtime, persistence, security-test, integration, and Mapping-0 evidence are still missing. fileciteturn15file0

## 6. Next closure unit

The next direct closure unit is an explicit `AUTH-004` wire-schema decision artifact. Only after that artifact freezes the request/response shapes may the canonical API contract, OpenAPI operation schemas, DTO registry, and Mapping-0 reconciliation be advanced.

## 7. Gate result

`AUTH-004 = BLOCKED_NOT_GREEN`

This is a controlled block, not a regression: the batch advances by freezing the exact decision boundary and preventing entity/persistence fields from being silently promoted into public API semantics.
