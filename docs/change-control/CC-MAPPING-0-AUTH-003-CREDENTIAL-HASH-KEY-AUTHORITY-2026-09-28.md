# CC-MAPPING-0-AUTH-003-CREDENTIAL-HASH-KEY-AUTHORITY-2026-09-28

## Status

`AUTHORITY_RECONCILED / IMPLEMENTATION_NOT_AUTHORIZED`

## Base

- main reviewed: `4ddf17f5d07cc3d33f9513145f9302aa5d22965d`
- backup: `backup/pre-auth003-key-authority-contract-20260928`
- implementation branch: `governance/auth003-key-authority-contract-20260928`
- related blocker: PR #134 `W02 credential-hash secret authority gap`

## Decision

AUTH-003 protected `ENT-CREDENTIAL.valueHash` is derived only inside the W02 / D1-01 server-side boundary with HMAC-SHA-256.

The canonical secret slots are:

- active: `AUTH003_CREDENTIAL_HASH_KEY`
- previous/rotation overlap: `AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS`

The active secret is mandatory for sensitive credential mutations and materialization. The previous slot is optional and exists only for a bounded rotation overlap.

## Why this closes the current authority gap

The decision uses the existing global secret lifecycle contract rather than creating a new secret-management system. It gives the existing `value_hash` schema a rotation-compatible verification path without adding a key-version column.

New hashes always use the active key. During rotation, verification may accept active or previous; successful authorized verification/update may re-derive the active hash. The previous key is retired only after its use is proven unnecessary.

## Security rules

- secrets remain in server-side Cloudflare Worker secret storage;
- secret values are never committed, persisted in D1, returned, logged or written to evidence;
- `PAYLOAD_SECRET` is not reused as the AUTH-003 credential-hash key;
- missing or invalid active key fails closed;
- no new Worker, Queue, D1 or persistence table/column is introduced;
- no change to Payload native password/recovery authority;
- no AUTH-003 entity or Mapping 0 GREEN promotion is implied.

## Implementation gate

Implementation remains blocked until:

1. the repository contract gate admits this authority;
2. W02 runtime configuration exposes the two canonical server-side bindings;
3. the existing credential hashing path is updated to consume the admitted active/previous slots;
4. controlled evidence proves rotation overlap and secret non-observability.

Production secret values themselves are operational inputs and must not enter Git.

## Authoritative references

- `contracts/security/AUTH-003-credential-hash-key-authority.v1.json`
- `contracts/entity/AUTH-003-credential-field-contract.v1.json`
- `docs/169-SECURITY-SECRET-KEY-LIFECYCLE-INCIDENT-CONTRACT-v1.0.md`
- `docs/71-PLATFORM-OPERATIONS-GOVERNANCE-RELIABILITY-CONTRACT-v1.0.md`
