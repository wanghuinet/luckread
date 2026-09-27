# CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-WRITER-BOUNDARY-2026-09-27

## Status

`WRITER_BOUNDARY_RECONCILED / CONSENT_DEPENDENCY_BLOCKED`

## Base

- Base main: `e28b1f9478bce49e0beba59705ec370e2c377b88`
- Backup branch: `backup/pre-auth001-registration-envelope-boundary-20260927`

## Decision

AUTH-001 uses a Payload-native, single-transaction registration envelope at W01 for the initial registration commit.

The authoritative W01 transaction contains:

1. the Payload-native `users` creation and native password handling;
2. the AUTH-001 registration idempotency/envelope record;
3. the response identity required to replay the committed registration outcome.

After that transaction commits, Identity/Credential materialization is **eventual** and remains owned by W02 / D1-01.

## Registration envelope

`AUTH-001_REGISTRATION_ENVELOPE` is a registration-local internal record, not a new generic idempotency platform.

The record must carry the existing canonical idempotency semantics:

- endpoint/scope;
- `Idempotency-Key`;
- normalized request `payload_hash`;
- committed response userId/status;
- createdAt/expiresAt;
- deterministic state sufficient to distinguish committed replay from key reuse.

The envelope is created in the same Payload transaction as the User creation. This preserves the existing canonical rule that the idempotency record and the protected registration write share one transaction.

The envelope is retained for the canonical 24-hour replay window. Expiry cleanup remains a housekeeping concern under the repository's existing idempotency cleanup authority.

## Why this is the minimum boundary

This decision avoids all of the previously forbidden designs:

- no distributed database transaction;
- no W01 direct Identity/Credential D1 write;
- no second Worker;
- no second D1;
- no generic idempotency subsystem;
- no Payload Core fork;
- no synchronous W01 -> W02 transaction dependency.

The existing W01 -> W02 Service Binding remains available for other admitted AUTH/T01/T03 calls, but AUTH-001 completion does not depend on a cross-worker commit.

## W02 materialization

After W01 commits, W02 owns the authoritative Identity/Credential materialization.

W02 consumes the existing durable registration envelope as a reconciliation source and reads the already-committed Payload User/native-auth source on the same D1 physical target.

Materialization is idempotent:

- if `auth_identities.user_id` already exists, the registration is considered materialized and is not duplicated;
- missing Identity/Credential rows are created using the existing AUTH-003 persistence and normalization rules;
- the Payload password remains exclusively under the native User/auth boundary;
- W02 does not mutate the registration envelope's authoritative replay record.

The current W02 scheduled execution boundary is the recovery mechanism. No new Queue or Worker is required by this decision.

## Failure model

Allowed intermediate state:

`W01 User committed -> Identity/Credential not yet materialized`.

During this interval the account remains governed by the existing `PENDING_VERIFICATION` registration lifecycle. Identity/Credential materialization must converge before verification-dependent promotion is admitted.

A W01 request replay uses the registration envelope and never creates a second User when the same key and payload are replayed.

Same key with a different payload remains the canonical `IDEMPOTENCY_KEY_REUSE_CONFLICT` case.

## Source authority

For the admitted email registration path:

- email source = Payload native User auth-managed email;
- username source = Payload User `username`;
- password source = Payload native auth password material;
- User ID source = Payload User `id`.

No phone source is part of AUTH-001 after the native-email entry decision.

## Remaining dependency

The writer boundary is now reconciled, but AUTH-001 remains blocked until the privacy/consent contract provides a canonical durable consent persistence authority.

The registration runtime must not be implemented until:

1. PRIV-002 consent persistence/retention/version semantics are admitted;
2. the registration envelope schema is admitted as the concrete persistence contract;
3. implementation and controlled evidence are executed against the admitted contract.

## Non-authorizations

This control does not authorize runtime code, migrations, new infrastructure, Mapping 0 GREEN, or Evidence Registry promotion.

## Result

The AUTH-001 registration writer is no longer blocked by an impossible cross-worker atomicity requirement. The minimum viable authority is W01 transactional registration envelope + W02 eventual identity/credential materialization, with no distributed transaction.

Consent remains the only unresolved contract dependency before implementation admission.