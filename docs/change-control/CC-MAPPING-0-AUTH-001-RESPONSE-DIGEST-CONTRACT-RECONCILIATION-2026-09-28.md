# CC-MAPPING-0-AUTH-001-RESPONSE-DIGEST-CONTRACT-RECONCILIATION-2026-09-28

## Status

`CONTRACT_SEMANTICS_RECONCILED / IMPLEMENTATION_AUTHORIZED_FOR_FOCUSED_SLICE`

## Purpose

Resolve the final AUTH-001 `response_digest` ambiguity without weakening the existing one-batch W01 registration boundary.

## Existing authority

The canonical idempotency contract defines:

- `payload_hash` as SHA-256 of normalized request JSON;
- `response_digest` as a COMPLETED-state replay/idempotency field;
- `committed_response` as the lossless logical replay body for AUTH-001.

The AUTH-001 persistence contract requires `committed_response = { userId, accountState }` for a completed registration.

The contract does **not** define `response_digest` as a SHA-256 of `committed_response`.

## Reconciled meaning

For AUTH-001, `response_digest` is now explicitly defined as a **pre-commit replay commitment digest**, not the cryptographic digest of the generated response body.

Its canonical input is the normalized JSON object:

```json
{
  "schema": "AUTH-001.response-digest.v1",
  "operationId": "authRegister",
  "endpoint": "/auth/register",
  "idempotencyKey": "<canonical Idempotency-Key>",
  "payloadHash": "<canonical payload_hash>",
  "status": 201,
  "accountState": "PENDING_VERIFICATION"
}
```

The digest is SHA-256 over the canonical UTF-8 JSON serialization of that object.

## Why this is admissible

All digest inputs are known before the D1 batch begins:

- operation and endpoint are fixed contract values;
- Idempotency-Key is request input;
- payloadHash is computed before persistence;
- HTTP 201 is fixed by the operation contract;
- the initial account state is contractually fixed at `PENDING_VERIFICATION`.

The generated User ID is intentionally **not** part of `response_digest`.

The actual replay response remains authoritative in `committed_response`, which contains the generated User ID and account state.

Therefore:

- the replay body remains lossless;
- the idempotency commitment can be inserted in the same atomic D1 batch;
- no second envelope-finalization write is required;
- no pseudo-hash or D1-specific cryptographic SQL function is required.

## Integrity boundary

`response_digest` is an operation-level replay commitment.

It MUST NOT be described or tested as proof that the stored `userId` in `committed_response` hashes to the digest.

The authoritative response identity is:

`committed_response.userId -> ENT-USER.id`

The authoritative replay body is `committed_response`.

The digest binds the completed operation to the canonical request, operation, status and initial account-state semantics.

## Required implementation behavior

The future AUTH-001 runtime MUST:

1. compute `payload_hash` from canonical normalized request JSON;
2. build the exact commitment object above;
3. compute SHA-256 with the runtime crypto API before entering `D1Database.batch()`;
4. persist the resulting `response_digest` in the same registration batch;
5. persist the final generated `userId` only in `committed_response`;
6. return the stored `committed_response` on same-key replay;
7. never recompute or mutate `response_digest` after the batch commits.

## Atomicity result

The prior blocker caused by the need to hash a post-INSERT generated User ID is removed.

The admitted one-batch boundary can now remain:

1. native Payload User persistence;
2. ENT-CONSENT persistence;
3. AUTH-001 Registration Envelope persistence;
4. final envelope values are all computable before batch submission.

No second transaction is required for normal completion.

## Non-authorizations

This control does not authorize:

- a new Worker, D1, Queue or idempotency platform;
- Payload Core modification;
- direct SQL replacement of Payload authentication;
- a new password implementation;
- production deployment;
- Evidence Registry promotion;
- Mapping 0 GREEN.

The next controlled step is the focused W01 registration batch implementation and same-SHA development evidence.

## Provenance

- Base main: `78a90c70dbc7c7ea7c42475642ba5842fd778914`
- Backup: `backup/pre-auth001-response-digest-contract-reconciliation-20260928`
- Change: `change-control/auth001-response-digest-contract-reconciliation-20260928`
- Prior design admission: PR #118
- Native Hash Capture proof: Actions run `36362963595`
- Prior response-digest blocker: PR #123

This is a contract-semantic reconciliation only. No runtime success is claimed.
