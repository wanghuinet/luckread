# AUTH-003 Replace Request Authority Audit v1

## Status

`BLOCKED_NOT_GREEN`

## Scope

This audit isolates the exact evidence available for `DTO-AUTH-003-CREDENTIAL-REPLACE-REQUEST` and its `{credentialId}` path parameter. It does not invent replacement wire fields or promote OpenAPI/DTO/Mapping state.

## Authoritative operation

`authCredentialReplace` — `PUT /auth/credentials/{credentialId}`.

The AUTH-003 feature contract fixes authenticated self scope, permission `user.credential.manage`, and required `Idempotency-Key`. fileciteturn128file0L2-L2

## Path parameter evidence

The repository has a cross-cutting `ResourceId` definition in `contracts/api/revision.v1.json`:

- type: `string`
- `minLength: 1`
- `maxLength: 128`

That contract uses the definition for other resource path parameters. fileciteturn153file0L2-L2

However, `docs/174-CANONICAL-ID-ENTITY-REFERENCE-UNIQUENESS-CONTRACT-v1.0.md` declares the current canonical ID namespaces as `user`, `creator`, `content`, `media`, `ip`, `order`, `ledger`, `community`, `app`, and `operation`; `credential` is not currently listed. The same contract also requires a stable canonical ID and separates identity from authorization. fileciteturn157file0L2-L2

### Gate conclusion

`credentialId` is confirmed as a path placeholder, and a generic `ResourceId` shape exists, but the repository does **not** yet provide sufficient evidence to admit `credentialId -> ResourceId` as the final AUTH-003 public parameter contract because credential authority/namespace is not yet explicitly bound.

No regex, encoding, UUID format, prefix, namespace syntax, or Payload internal ID mapping is inferred.

## Replace request-body evidence

The AUTH-003 feature contract fixes:

- the operation identity;
- the credential kinds `username | email | phone`;
- deterministic normalization rules;
- validation before authoritative replacement;
- required verification when the credential policy requires it;
- self-scoped authorization;
- concurrency uniqueness at the persistence boundary.

It does **not** define the public request body field names or requiredness. In particular, it does not prove whether Replace accepts `kind`, whether kind changes are legal, or what field carries the raw credential input. fileciteturn128file0L2-L2

The existing AUTH-003 request gate therefore remains correct: exact wire fields, requiredness, replacement-kind semantics, validation mapping, and conflict mapping remain unresolved. fileciteturn161file0L2-L2

## Security constraints already established

The request contract must not accept server-owned fields such as `identityId`, `valueHash`, `normalizedValue`, `verifiedAt`, `active`, `createdAt`, or `updatedAt` unless a separate explicit client-input contract is introduced. Credential values, normalized values, and derived hashes must not be returned publicly or logged. fileciteturn134file0L2-L2

The unified error contract requires stable machine-readable error envelopes and requires domain errors to map to common categories such as `VALIDATION`, `AUTHORIZATION`, `NOT_FOUND`, and `CONFLICT`; it does not by itself define an AUTH-003-specific code or HTTP mapping. fileciteturn148file0L2-L2

## Promotion decision

`PATH_PLACEHOLDER_CONFIRMED / PUBLIC_PARAMETER_NOT_CLOSED / BODY_SCHEMA_NOT_CLOSED`

Therefore:

- `NO_OPENAPI_WRITE`
- `NO_DTO_REGISTRY_PROMOTION`
- `NO_MAPPING_PROMOTION`
- `NO_RUNTIME_IMPLEMENTATION_AUTHORIZATION`

## Next exact closure tasks

1. Explicitly bind `credentialId` to the canonical ID namespace and public `ResourceId` definition.
2. Explicitly decide whether Replace carries `kind`.
3. Explicitly decide whether credential-kind changes are allowed or forbidden.
4. Define the raw submitted credential field name and exact wire constraints.
5. Define unknown-property behavior.
6. Define validation and generic credential-conflict HTTP/error semantics.

## Evidence boundary

This artifact is contract/audit evidence only. It does not constitute runtime, D1, migration, concurrency, security-E2E, or Mapping-0 verification.
