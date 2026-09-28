# CC-MAPPING-0-AUTH-001-RESPONSE-DIGEST-ATOMICITY-GAP-2026-09-28

## Status

`BLOCKED_CONTRACT_SEMANTICS_REQUIRED / AUTH-001_RUNTIME_NOT_ADMITTED`

## Trigger

The admitted AUTH-001 design now has a proven Payload-native hash capture boundary and an admitted Cloudflare D1 `batch()` commit seam.

The remaining unresolved field is `AUTH-001_REGISTRATION_ENVELOPE.response_digest`.

The persistence Contract requires:

- `response_digest` to be present when envelope state is `COMPLETED`;
- `committed_response` to contain the exact `{userId, accountState}` replay body.

The Payload/D1 physical User primary key is an auto-generated integer. Therefore the canonical response body is not fully known until the User INSERT has executed.

## Verified D1 capability boundary

Cloudflare's current D1 SQL documentation lists the supported SQL extensions as FTS5, JSON, and Math. It does not document a SHA-256 SQL function in D1. citeturn191176search0

Cloudflare's current D1 `batch()` documentation states that prepared statements are executed sequentially and transactionally, with the complete batch rolled back when a statement fails. citeturn191176search7

Cloudflare's `sha256()` function documented in January 2026 is a Cloudflare Rules expression function, not a D1 SQL function. citeturn529089search0

## Why this matters

A strict implementation would need to perform:

1. Payload-native User creation.
2. Consent creation.
3. Registration-envelope creation with final `committed_response`.
4. `response_digest = SHA-256(committed_response)`.
5. One atomic D1 commit.

The User ID is allocated by SQLite/D1 during step 1. Application code cannot compute the final response SHA-256 until the generated User ID is known.

D1's batch result becomes available only after the batch executes. A second update batch would make envelope completion a separate transaction and therefore would not preserve the admitted single atomic W01 registration outcome.

## Current conclusion

This is **not** an authorization to invent:

- a pseudo digest;
- a digest of the request instead of the response;
- a two-phase User/Consent/Envelope commit;
- an asynchronous envelope finalizer;
- a compensating-delete transaction;
- a second idempotency system;
- a new Worker/Queue/D1 database;
- a Payload Core modification.

Those approaches would change the meaning or atomicity of the existing Contract.

## Decision material

The current Contract leaves the exact `response_digest` algorithm unspecified, while the historical AUTH-001 implementation draft computed a SHA-256 digest in application code after constructing the final response body.

Therefore the implementation gate remains blocked until the repository explicitly admits one of the following through normal Change Control:

### Path A — Contract clarification

Explicitly define `response_digest` as an opaque deterministic replay-integrity value that can be derived before the D1 batch and does not require the generated User ID.

This would require a Contract semantic reconciliation, not a runtime shortcut.

### Path B — D1 capability change

A future supported D1 SQL capability could provide the required cryptographic function inside the same batch.

No such D1 SQL capability is admitted by the current platform documentation.

### Path C — Atomicity contract change

Explicitly permit a post-commit envelope finalization step.

This would change the current requirement that the registration envelope and protected User write share one atomic W01 commit and therefore requires a higher-level Contract/Change Control decision.

## Non-authorizations

Until one path is explicitly admitted:

- AUTH-001 runtime implementation remains blocked.
- No production deployment is authorized.
- No registration migration is applied.
- No Evidence Registry promotion occurs.
- Mapping 0 remains NOT_GREEN for this runtime slice.

## Provenance

- Current main before this control: `b430a1559f73bf336a1f6bdf28624a9a94aad262`
- Backup: `backup/pre-auth001-response-digest-atomicity-gap-20260928`
- Change: `governance/auth001-response-digest-atomicity-gap-20260928`
- Native Payload hash capture proof: Actions run `36362963595` = SUCCESS
- Active design admission: PR #118 merged
- Current runtime blocker remains an implementation admission gate, not runtime evidence.

## Evidence boundary

This control is governance/decision material only. It does not claim runtime success, physical persistence proof, or GREEN status.
