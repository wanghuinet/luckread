# CC-MAPPING-0-AUTH-001-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-27

## Status

`CONTRACT_PRECONDITIONS_RECONCILED / DEV_TEST_RUNTIME_ADMISSIBLE / PRODUCTION_BLOCKED`

## Preconditions already reconciled

AUTH-001 has admitted:

- Payload-native User creation and native password handling;
- canonical Idempotency-Key semantics and 24h retention;
- replayable committed response `{userId, accountState}` with HTTP 201;
- initial `PENDING_VERIFICATION` / version 1 persistence dependency;
- concrete PRIV-002 consent contract;
- AUTH-001 envelope binding `consent_record_id -> ENT-CONSENT.id`;
- W01 same-transaction writer boundary;
- W02/D1-01 eventual Identity/Credential materialization.

## Newly discovered runtime precondition gap

`ENT-CONSENT.retentionUntil` is contractually required and must be server-calculated from the applicable lifecycle retention policy. Current authoritative sources define the lifecycle semantics but do not admit a concrete PRIV-004 policy authority/approved policy instance. Therefore runtime implementation is fail-closed until PRIV-004 is admitted. No retention duration is invented in AUTH-001.

See `docs/change-control/CC-MAPPING-0-PRIV-004-POLICY-INSTANCE-ADMISSION-2026-09-27.md` and `docs/change-control/CC-MAPPING-0-PRIV-004-RETENTION-POLICY-AUTHORITY-GAP-2026-09-27.md`.

Production authority discovery remains unresolved, but a separate development-only instance `DEV-2026-09-28.1` is now admitted for deterministic engineering validation. It is not a legal/compliance authority and cannot authorize production.

## Smallest runtime slice

Implementation is constrained to the existing W01 Payload worker and the already-admitted W02 materialization boundary.

Expected code/config surface:

1. `workers/W01-payload/src/app/auth/register/route.ts`
   - canonical `POST /auth/register` transport;
   - validates the admitted request DTO;
   - applies Idempotency-Key semantics;
   - executes one Payload transaction for User + registration envelope + Consent;
   - returns the canonical 201 body or deterministic idempotency conflict response;
   - never writes `auth_identities` / `auth_credentials` directly.

2. W01 Payload collection/config additions for the admitted internal records:
   - AUTH-001 registration envelope fields from `contracts/persistence/AUTH-001-registration-envelope-contract.v1.json`;
   - ENT-CONSENT fields from `contracts/entity/PRIV-002-consent-field-contract.v1.json`.
   Physical collection/table names remain implementation details and require migration evidence.

3. Existing W01 Payload native User boundary remains the password/auth authority. No Payload Core modification is permitted.

4. Existing W02 scheduled reconciliation remains the eventual Identity/Credential materializer. No new Worker, D1 binding or Queue is permitted.

## Required runtime behavior

Positive:
- new email registration commits User + Consent + envelope atomically;
- returned User ID and accountState match the committed response contract;
- accountState is sourced from existing D1 default `PENDING_VERIFICATION`.

Idempotency:
- same key + same payload after COMPLETED replays the original 201 body;
- same key + same payload while IN_PROGRESS returns `IDEMPOTENCY_IN_PROGRESS`;
- same key + different payload returns `IDEMPOTENCY_KEY_REUSE_CONFLICT`;
- expired key is treated as a new request.

Consent:
- registration creates `ENT-CONSENT` with `ACCOUNT_REGISTRATION / CONSENT / GRANTED`;
- policyVersion is persisted and immutable;
- retentionClass is server-set to `LEGAL_AUDIT`;
- retentionUntil is server-calculated;
- consent record ID is retained by the registration envelope.

Security:
- no password/credential secret is returned;
- no account enumeration;
- malformed/invalid consent is rejected;
- unauthorized consent mutation is not exposed by registration;
- replay never creates a second User or Consent.

Failure:
- User/Envelope/Consent transaction rolls back together;
- W02 materialization may remain temporarily incomplete after W01 commit;
- replay remains authoritative from the W01 envelope.

## Evidence admission matrix

Runtime promotion requires controlled evidence for:

- happy-path registration;
- duplicate replay;
- key reuse conflict;
- concurrent same-key submission;
- consent policy-version validation;
- rollback/no-partial-write behavior;
- no-secret/no-enumeration response behavior;
- W01/W02 convergence after commit;
- exact source SHA provenance;
- D1 schema/migration evidence for the actual implemented physical collections.

No documentation-only run may promote AUTH-001 GREEN.

## Explicit non-authorizations

- no Payload Core fork/patch;
- no direct W01 -> D1-01 identity/credential write;
- no new generic Idempotency service;
- no new Worker/D1/Queue;
- no reuse of unrelated AUTH-013/D1-03 idempotency journals;
- no Mapping 0 GREEN until runtime and Evidence Registry gates pass.

## Development gate

Development/integration implementation may proceed only when both conditions are true:

1. the admitted `DEV-2026-09-28.1` policy instance is selected by the development environment; and
2. Contract Admission DEVELOPMENT is PASS_VERIFIED on the current admitted change.

Observed Contract Admission evidence:
- workflow: `.github/workflows/contract-admission-v2.yml`
- run: `36356226141`
- source: `8181df2ac1265f7a5cd64225f8f95a03ef95a067`
- applicable DEVELOPMENT gates: PASS_VERIFIED
- FULL-only R4/Evidence/Five-Way/OpenAPI stages remain outside this development admission.

The development policy is deterministic and server-controlled, but it is not a production legal/compliance authority.

## Production gate

Production implementation, production deployment and Evidence Registry promotion remain blocked until a real production `ACCOUNT_REGISTRATION / LEGAL_AUDIT` policy instance is admitted with the required legal/compliance authority and approval evidence.

Runtime evidence remains a separate promotion gate.
