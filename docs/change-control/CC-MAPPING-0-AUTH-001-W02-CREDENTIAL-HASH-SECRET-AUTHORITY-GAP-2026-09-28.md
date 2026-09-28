# CC-MAPPING-0-AUTH-001-W02-CREDENTIAL-HASH-SECRET-AUTHORITY-GAP-2026-09-28

## Status

`IMPLEMENTATION_BLOCKED / SECRET_AUTHORITY_REQUIRED`

## Base

- main reviewed: `4ddf17f5d07cc3d33f9513145f9302aa5d22965d`
- backup branch: `backup/pre-auth001-w02-secret-authority-gap-20260928`
- work branch: `governance/auth001-w02-secret-authority-gap-20260928`

## Observed facts

1. AUTH-001 consistency authority now admits eventual materialization by W02/D1-01 from the registration envelope plus the committed Payload User source.
2. AUTH-003 physical schema and runtime contracts require `auth_credentials.value_hash` and define its derivation through an application secret/key boundary.
3. Existing `workers/W02-content/src/credentials/credential-add.ts` requires a runtime `secret` input and derives `value_hash` with HMAC-SHA-256.
4. The W02 Worker configuration currently declares D1-01 and the existing AUTH-013 queue, but the repository does not contain an admitted W02 credential-HMAC secret binding/name or an authority artifact specifying which secret is used for AUTH-001 materialization.
5. AUTH-003 migration evidence intentionally performs no credential backfill because no authorized application secret context exists.

## Consequence

The AUTH-001 W02 materializer cannot safely create the required initial `ENT-CREDENTIAL` rows until the application-secret authority is explicitly admitted.

Inventing one of the following by implementation inference is forbidden:

- reusing `PAYLOAD_SECRET` or another W01-only secret;
- reusing an unrelated W02 session/idempotency secret;
- deriving hashes without the admitted secret boundary;
- adding a new secret solely in code without an authority/rotation contract;
- persisting the raw username/email value in place of `value_hash`.

## Required next decision

Admit a single W02/D1-01 credential-hash secret authority that defines at minimum:

- canonical secret binding/name for the W02 Worker;
- purpose scope limited to protected AUTH-003 credential hashing;
- rotation/version semantics compatible with existing hashes;
- runtime failure behavior when the secret is absent;
- secret non-observability requirements;
- controlled evidence proving the same secret authority is used by credential Add and AUTH-001 materialization.

Production secret material itself must never be committed to the repository or included in evidence.

## Non-actions

- no new secret is generated or committed;
- no W02 materializer runtime is implemented;
- no D1 migration or schema change;
- no AUTH-003 runtime rerun;
- no Payload Core change;
- no new Worker/Queue/D1;
- no Mapping 0 GREEN.

## Result

The eventual materialization architecture is closed. The next implementation blocker is now explicitly reduced to one authority question: the W02 application secret/key boundary for `auth_credentials.value_hash`.
