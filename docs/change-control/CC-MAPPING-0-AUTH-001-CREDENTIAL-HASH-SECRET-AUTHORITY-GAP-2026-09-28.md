# CC-MAPPING-0-AUTH-001-CREDENTIAL-HASH-SECRET-AUTHORITY-GAP-2026-09-28

## Status

`GAP_IDENTIFIED / IMPLEMENTATION_BLOCKED`

## Scope

Close the authority audit around the W02 scheduled AUTH-001 Identity/Credential materialization prerequisite. This record does not add a secret, Worker binding, runtime code, migration, or production authorization.

## Base

- main source head reviewed: `d6d32259efb9173840c785db778d82548a7def5c`
- backup branch: `backup/pre-auth001-canonical-mapping-sync-20260928`
- work branch: `reconcile/auth001-canonical-mapping-sync-20260928`

## Findings

1. AUTH-001 operation policy already freezes eventual Identity/Credential materialization under W02/D1-01, sourced from the registration envelope plus the native Payload User source and recovered by W02 scheduled reconciliation.
2. AUTH-003 `value_hash` is explicitly classified as secret-derived material and its migration states that derivation belongs to the application secret/key boundary.
3. The existing W02 `normalizeCredentialValue()` / `hashCredentialValue()` implementation requires an explicit `secret` input; the production W02 Worker environment contract currently declares D1 and AUTH-013 Queue bindings but no admitted credential-hash secret binding.
4. W01 has an existing `PAYLOAD_SECRET`, but no current authority permits reusing the W01 Payload runtime secret as the W02 AUTH-003 credential-derivation secret. Reusing it by inference would couple independent secret domains.
5. Therefore the W02 materializer cannot safely create the initial AUTH-003 username/email credential rows yet, even though the Identity/Credential persistence schema and normalization algorithm are already admitted.

## Required authority input before implementation

The next Change Control must explicitly admit the application secret/key boundary for AUTH-003 credential derivation, including at minimum:

- owning security authority and environment scope;
- the W02 Worker secret binding/source for `value_hash` derivation;
- derivation version and algorithm/key-separation semantics compatible with the existing AUTH-003 implementation;
- rotation/version handling so existing credential verification remains deterministic during an approved rotation window;
- operational provisioning/rotation path without placing secret material in Git, evidence artifacts, D1 rows, logs, or API responses.

Exact binding name and secret lifecycle are intentionally not invented here.

## Non-actions

- no `wrangler secret` creation;
- no reuse of `PAYLOAD_SECRET` by inference;
- no hard-coded fallback secret;
- no new D1 table/column;
- no W02 materializer implementation;
- no deployment or runtime rerun;
- no Evidence Registry promotion;
- no Mapping 0 GREEN.

## Next governed gate

Admit the AUTH-003 application secret/key boundary for W02. After that authority is GREEN, the smallest implementation slice can add the existing W02 scheduled registration materializer using the already-admitted normalization/hash functions and the existing `auth_identities` / `auth_credentials` persistence boundary.
