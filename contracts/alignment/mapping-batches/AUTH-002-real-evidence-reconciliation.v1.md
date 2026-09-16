# AUTH-002 Real-Evidence Reconciliation v1.8

## Status

`BLOCKED_NOT_GREEN`

## Authority

This file is the current reconciliation summary for `AUTH-002`. It is subordinate to the canonical contracts and executable evidence validators referenced below; it must never manufacture GREEN status.

## Canonical references

- API policy: `contracts/api/auth-operation-policy.v1.json`
- Session field contract: `contracts/entity/AUTH-002-session-field-contract.v1.json`
- Minimum native-session integration contract: `contracts/persistence/AUTH-002-minimum-session-integration-contract.v1.json`
- Extension persistence contract: `contracts/persistence/AUTH-002-minimum-session-extension-persistence-contract.v1.1.json`
- Gate-1 schema evidence contract: `contracts/persistence/AUTH-002-schema-catalog-evidence-contract.v1.json`
- Gate-1 capture procedure: `contracts/persistence/AUTH-002-schema-evidence-capture-contract.v1.0.md`
- Gate-1 validator: `scripts/auth-session-schema-evidence-validate.mjs`
- Gate-1 workflow: `.github/workflows/auth-session-schema-evidence.yml`
- Gate-2 runtime evidence gate: `contracts/persistence/AUTH-002-runtime-session-evidence-gate.v1.json`
- Gate-2 execution runbook: `contracts/persistence/AUTH-002-runtime-evidence-execution-runbook.v1.md`
- Shared persistence evidence contract: `contracts/evidence/AUTH-002-006-persistence-evidence-contract.v1.json`
- Shared Mapping-0 binding: `contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json`
- Promotion matrix: `contracts/alignment/mapping-batches/AUTH-002-promotion-matrix.v1.json`

## Corrected architectural facts

1. Payload 3.87.1 native session identity remains authoritative for the native session `sid`, including native `createdAt` and `expiresAt` where runtime evidence proves the concrete representation.
2. `auth_session_state` is an extension record only; it is not a replacement or mirror of `users.sessions[]`.
3. `auth_session_state.session_id` MUST equal the native Payload `sid`; no second session identity is permitted.
4. The extension state is limited to unsupported canonical dimensions: `device_id`, `token_version`, `refresh_credential_hash`, `revoked_at`, and `last_seen_at`, plus the authoritative `user_id` linkage.
5. A physical foreign key from `session_id` to an embedded `users.sessions[]` element is not permitted; that relationship is logical.
6. Raw access tokens, refresh tokens, passwords, session cookies, credential hashes and Cloudflare credentials are prohibited from evidence artifacts.

These facts supersede older wording that described the Session field contract as missing or empty. The canonical Session field contract now exists, but remains `CONTRACTED_NOT_VERIFIED` until execution evidence is accepted.

## Gate matrix

| Gate | Current state | Promotion requirement |
|---|---|---|
| Contract | `CLOSED` | Canonical contracts frozen |
| Gate 1 workflow | `IMPLEMENTED` | Workflow exists and is fail-closed |
| Gate 1 execution | `NOT VERIFIED` | Controlled remote D1 execution + accepted artifacts |
| Native session runtime | `NOT EXECUTED` | Real Payload login/session/validation/logout correlation |
| Extension schema | `NOT VERIFIED` | Actual D1 schema must match accepted evidence |
| Migration | `NOT PROMOTED` | Versioned migration + successful execution + postconditions |
| Security E2E | `NOT VERIFIED` | Negative/security suite passes |
| Concurrency E2E | `NOT VERIFIED` | Refresh/logout/validation invariants pass |
| Evidence Registry | `NOT BOUND` | Non-empty records bound to exact commit |
| Mapping-0 | `NOT VERIFIED` | Validator passes against same commit/evidence |
| ENT-SESSION | `PROPOSED / CONTRACTED_NOT_VERIFIED` | All required runtime/persistence evidence accepted |
| AUTH-002 | `BLOCKED_NOT_GREEN` | All required gates accepted |

## Execution work packages

### WP-1 — Gate-1 remote schema evidence

Required inputs:

- exact tested commit SHA;
- named controlled remote D1 target/environment identity;
- expected schema/catalog contract;
- generated actual schema snapshot;
- expected-vs-actual comparison;
- validator output.

Acceptance conditions:

- target identity is explicit;
- artifact is generated from the tested commit;
- actual schema is captured from the real controlled D1 target;
- comparison is machine-verifiable;
- `auth-session-schema-evidence-validate.mjs` passes;
- no secret-bearing value is present.

Output: an accepted Gate-1 evidence package bound to the exact tested commit SHA.

### WP-2 — Gate-2 native session runtime correlation

Required execution path:

`authLogin -> native session creation -> session read/validate -> authLogout -> post-logout validation`

Required observations:

- native Payload session `sid`;
- native session timestamps as actually represented;
- user linkage;
- authorization result before and after logout;
- correlation between native `sid` and any extension `auth_session_state.session_id`.

Acceptance conditions:

- the observed session is a real runtime object, not a fixture-only assertion;
- extension `session_id == native sid` where an extension record exists;
- revoked/expired session cannot authorize;
- no second independent session identity is introduced;
- evidence is bound to the same tested commit and environment identity.

Output: accepted Gate-2 runtime evidence.

### WP-3 — Extension persistence correlation

Required observations:

- actual `auth_session_state` row/record shape;
- canonical supported fields only;
- user linkage;
- state transition behavior for revoke/refresh/last-seen dimensions;
- absence of a second full session table.

Acceptance conditions:

- actual persisted representation matches the canonical extension contract;
- native `sid` is the sole session identity;
- no prohibited credential material is persisted or emitted;
- native/extension disagreement fails closed where authorization depends on both.

Output: accepted persistence correlation evidence.

### WP-4 — Migration execution and postconditions

Required execution:

`versioned migration -> apply to controlled target -> inspect resulting schema -> runtime persistence tests -> negative/security/concurrency checks`

Acceptance conditions:

- migration version is explicit;
- execution target and commit are explicit;
- migration completes successfully;
- post-migration schema is captured;
- runtime behavior is tested against the migrated state;
- rollback/stop behavior follows the existing migration contract where applicable.

Output: accepted migration execution evidence.

### WP-5 — Security and concurrency evidence

Required negative/security coverage:

- revoked session rejected;
- expired session rejected;
- malformed/unknown session rejected;
- credential leakage prohibited;
- cross-user session confusion prohibited;
- refresh replay prohibited;
- duplicate successor from one refresh predecessor prohibited.

Required concurrency coverage:

- concurrent refresh preserves single-successor invariant;
- concurrent logout/validate cannot authorize a revoked session;
- stale session state cannot overwrite a newer valid state;
- repeated validation is deterministic for the same accepted state.

Output: accepted security/concurrency evidence bound to the same tested commit.

### WP-6 — Evidence Registry and Mapping-0 binding

Required registry contents:

- non-empty evidence records;
- unique evidence IDs;
- exact commit SHA;
- environment/target identity;
- gate/work-package association;
- artifact references;
- pass/fail result;
- validator result where applicable.

Acceptance conditions:

- empty registry is a hard fail;
- stale-commit evidence is a hard fail;
- missing environment identity is a hard fail;
- documentation-only evidence is a hard fail;
- evidence chain is complete from Gate-1 through security/concurrency;
- Mapping-0 validation references the same tested commit and accepted evidence.

Output: accepted Evidence Registry + Mapping-0 result.

## Required promotion order

`WP-1 Gate-1 -> WP-2 Gate-2 runtime -> WP-3 extension correlation -> WP-4 migration -> WP-5 security/concurrency -> WP-6 Evidence Registry -> Mapping-0 -> ENT-SESSION verification -> AUTH-002 promotion`

A failed work package blocks all dependent work packages. Status text may never be used to bypass an unmet acceptance condition.

## Fail-closed invariants

- Empty Evidence Registry cannot pass.
- Documentation-only evidence cannot pass.
- Stale commit evidence cannot pass.
- Missing environment identity cannot pass.
- Missing actual schema snapshot cannot pass.
- Missing expected-vs-actual comparison cannot pass.
- Missing migration execution/postcondition evidence cannot pass.
- A second full `sessions` table blocks promotion.
- A second independent session identifier blocks promotion.
- Any secret in evidence blocks promotion.
- Native session state and canonical extension state disagreement MUST fail authorization closed where both are authoritative inputs to the decision.

## Current conclusion

`AUTH-002` remains **not GREEN**. The repository has the contract, fail-closed promotion matrix, schema-evidence gate, runtime-evidence gate, migration gate, and Mapping-0 binding required to perform verification, but the controlled D1/Payload execution evidence has not yet been accepted. Therefore migration promotion, `ENT-SESSION` verification, and Mapping-0 promotion remain blocked.

## Immediate next action

Execute **WP-1 Gate-1 remote schema evidence** on a named controlled D1 target using the exact tested commit SHA. Preserve the generated artifact package and run `scripts/auth-session-schema-evidence-validate.mjs`. Only an accepted Gate-1 result for that exact commit may unlock WP-2.
