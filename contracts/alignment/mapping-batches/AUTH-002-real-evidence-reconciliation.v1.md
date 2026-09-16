# AUTH-002 Real-Evidence Reconciliation v1.7

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

## Required execution chain

`Gate-1 remote D1 evidence -> Gate-1 acceptance -> Gate-2 native runtime evidence -> extension correlation -> migration execution evidence -> security/concurrency evidence -> Evidence Registry -> Mapping-0 validation -> AUTH-002 promotion`

No step may be skipped or inferred from documentation.

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
- Native session state and canonical extension state disagreement MUST fail authorization closed.

## Current conclusion

`AUTH-002` is **not GREEN**. The repository now has the contract and machine-gate structure needed to perform the real verification, but the actual controlled D1 and Payload runtime evidence has not been accepted. Therefore migration application, runtime promotion, `ENT-SESSION` verification and Mapping-0 promotion remain blocked.

## Next action

Execute Gate 1 against a named controlled remote D1 target, preserve the generated evidence artifact package, and evaluate it with `auth-session-schema-evidence-validate.mjs`. Only an accepted Gate-1 result for the exact tested commit may unlock Gate 2 runtime correlation.
