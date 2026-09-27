# CC-MAPPING-0-AUTH-001-IDEMPOTENCY-CANONICAL-SEAM-RECONCILIATION-2026-09-27

## Status

`CANONICAL_SEMANTICS_RECONCILED / REGISTRATION_BINDING_BLOCKED`

## Base

- Base main: `0af81384584f27f2b8d472802ddb1f237fe3533d`
- Backup branch: `backup/pre-auth001-idempotency-seam-reconcile-20260927`

## Scope

This control closes the semantic-design question for AUTH-001 idempotency by binding it to the repository's existing canonical idempotency contract.

It does not authorize a new idempotency platform, migration, Worker, D1 binding, registration handler, or Mapping 0 promotion.

## Existing canonical authority

The repository already defines the canonical idempotency semantics in:

- `docs/305-CONCURRENCY-ETAG-CONDITIONAL-REQUEST-AND-IDEMPOTENCY-CONTRACT-v1.0.md`;
- `contracts/schemas/common/idempotency-key.json`.

The canonical record model contains:

- `idempotency_key`;
- `scope`;
- `endpoint`;
- `payload_hash`;
- `state`;
- `response_digest`;
- `created_at`;
- `expires_at`.

The existing contract defines:

- normalized-request SHA-256 for `payload_hash`;
- 24-hour default retention;
- same key + same payload + COMPLETED => first response;
- same key + same payload + IN_PROGRESS => 409 `IDEMPOTENCY_IN_PROGRESS`;
- same key + different payload => 422 `IDEMPOTENCY_KEY_REUSE_CONFLICT`;
- expired key => a new request;
- required-key absence => 400 `IDEMPOTENCY_KEY_REQUIRED`;
- idempotency record and protected business write must share one transaction;
- W08 performs expiry cleanup.

No second semantic design is needed for AUTH-001.

## Current implementation evidence

W01 HTTP foundation already recognizes the canonical idempotency error vocabulary, including:

- `IDEMPOTENCY_IN_PROGRESS`;
- `IDEMPOTENCY_KEY_REUSE_CONFLICT`.

AUTH-003 also has operation-local idempotency behavior, but its deterministic credential ID is derived from the credential operation and is not an AUTH-001 registration replay authority.

Current-source inspection does not establish a durable AUTH-001 registration IdempotencyRecord implementation.

## Binding boundary

The remaining issue is authority binding, not idempotency semantics.

Current architecture records:

- D1-03 as the operational/idempotency authority;
- D1-01 as the identity/account authority;
- W02 currently owns the D1-01 binding;
- AUTH-001 requires one authoritative registration outcome and a bounded write envelope;
- registration must preserve Payload-native password handling.

Therefore the repository must not silently:

- add a generic idempotency table;
- make W01 a D1-03 writer;
- give W02 a second D1 binding;
- reuse AUTH-013 publication-journal idempotency;
- reuse AUTH-003 credential idempotency;
- split the idempotency record and the protected registration outcome across independent transactions.

The existing canonical semantic contract is accepted as the AUTH-001 semantic source. The missing decision is where that record is transactionally bound to the registration writer outcome.

## Recovery implication

Because AUTH-001 registration can cross the Payload-native User boundary and the W02/D1-01 Identity/Credential boundary, the final binding must distinguish:

- first submission;
- same-request replay;
- same key with changed request body;
- partially completed registration;
- a failed registration outcome safe to retry.

The binding must preserve the existing canonical error and retention semantics.

## Gate result

Closed:

- canonical Idempotency-Key syntax authority;
- canonical payload-hash semantics;
- canonical replay/conflict semantics;
- canonical 24-hour retention semantics;
- canonical requirement that the idempotency record and protected write share a transaction;
- no need to invent a second idempotency semantic model.

Still blocked:

1. phone registration durable/native source;
2. canonical consent persistence authority;
3. concrete AUTH-001 registration writer boundary that can satisfy the transaction rule;
4. concrete handler and executable security/anti-abuse/integration evidence;
5. Evidence Registry admission / Mapping 0 promotion.

## Non-authorizations

This control does not authorize:

- a new generic idempotency subsystem;
- a second D1;
- a new Worker;
- a new Queue;
- a W01 D1-03 write;
- reuse of AUTH-013 consumer idempotency as registration authority;
- implementation of `authRegister`.

## Result

AUTH-001 no longer needs a new idempotency semantic design.

The next registration Change Control only needs to bind the already-canonical IdempotencyRecord semantics to the admitted registration writer/transaction boundary while resolving the remaining phone and consent authority gaps.
