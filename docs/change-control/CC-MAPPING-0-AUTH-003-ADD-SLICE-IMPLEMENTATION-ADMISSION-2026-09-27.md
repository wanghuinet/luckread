# CC-MAPPING-0-AUTH-003-ADD-SLICE-IMPLEMENTATION-ADMISSION-2026-09-27

Status: **IMPLEMENTATION SLICE ADMITTED / RUNTIME EVIDENCE REQUIRED**

## Scope

Admit only the smallest executable AUTH-003 persistence/runtime slice:

`authCredentialAdd → normalization → persistence uniqueness boundary → deterministic idempotency → self-authorization/security-negative evidence`

Current authoritative main at admission: `690b90061f01d321809a9bc9da7bcc00739ae9c7`.

## Existing authority carried forward

- Task edge: `AUTH-003 → T01 → W02 → D1-01`.
- Physical target: `luckread-w02 / workers/W02-content / D1-01 / luckread`.
- Canonical add operation: `POST /auth/credentials`.
- Request: `kind`, `value`; mutation requires `Idempotency-Key`.
- Authorization: authenticated self scope with `user.credential.manage`.
- Normalization:
  - username/email: trim → Unicode NFC → casefold;
  - phone: E.164 parse/validation.
- Uniqueness authority: persistence boundary, `kind + normalizedValue`.
- Public projection: `credentialId`, `kind`, `active`.
- Credential value, normalized value, hash and identity metadata are non-public.
- Event/queue budget for AUTH-003 is zero.
- Payload native authentication/recovery remains the authentication substrate; this slice does not replace it.

## Admitted implementation boundary

The implementation may:

1. require an already-existing AUTH-003 `auth_identities` row for the authenticated user;
2. normalize the requested credential value;
3. derive `value_hash` through an application secret/key boundary;
4. derive a deterministic credential identifier from self identity + `Idempotency-Key`;
5. perform the authoritative `auth_credentials` insert;
6. treat the database uniqueness boundary as authoritative under concurrent insert;
7. replay the same request by deterministic credential identity without creating a second row;
8. return only the contracted public projection.

The implementation must not:

- add public W02 transport in this slice;
- add identity provisioning/backfill;
- modify Payload native authentication/recovery;
- add an idempotency table, queue, cache, Worker, D1, or RPC;
- implement Replace/Remove/List in the same slice;
- promote ENT-IDENTITY or ENT-CREDENTIAL to GREEN;
- mark AUTH-003 or Mapping 0 GREEN.

## Evidence gate

Required next evidence, bound to one exact tested source SHA:

- local unit validation of normalization, hashing, idempotent replay and security boundaries;
- controlled remote D1 runtime evidence;
- concurrent uniqueness negative/positive result;
- cross-account authorization denial before mutation;
- confirmation that public evidence contains no raw credential, normalized value or hash;
- cleanup of all synthetic remote rows.

Only after those executable inputs are registered may the AUTH-003 persistence/runtime claim be admitted into the Evidence Registry.
